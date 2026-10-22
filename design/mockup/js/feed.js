// Created by The Angelo Umali.
"use strict";

/* Screen 3, agent feed primitives: one renderer per StudioEvent kind (plan §6.11), each mirrored to the terminal view.
   Agent-written strings (labels, narration, options, reasons) only ever reach the DOM as text nodes (plan §9.1, §11). */

const feed = $("#feed");

function feedPush(node) {
  const item = h("li", {}, node);
  feed.append(item);
  $("#feed-empty").hidden = true;
  feed.scrollTop = feed.scrollHeight;
  return item;
}

function systemRow(text) {
  editorTerminal.line(text, "dim");
  return feedPush(h("p", { class: "ev-system mono" }, text));
}

function userRow(text) {
  editorTerminal.line(`> ${text}`, "cmd");
  return feedPush(h("p", { class: "ev-user" }, text));
}

/* text.delta: narration streams in; reduced motion gets the whole sentence at once. */
async function narrate(text, signal) {
  editorTerminal.line(text, "say");
  const node = h("p", { class: "ev-text" });
  feedPush(node);
  if (reducedMotion.matches) {
    node.textContent = text;
    return;
  }
  for (let index = 0; index < text.length; index += 3) {
    node.textContent = text.slice(0, index + 3);
    feed.scrollTop = feed.scrollHeight;
    await wait(16, signal);
  }
}

function setAgentStatus(state, text) {
  $("#agent-status").dataset.state = state;
  $("#agent-status-text").textContent = text;
}

function progressBar(label) {
  return h(
    "div",
    {
      class: "progress",
      role: "progressbar",
      "aria-label": label,
      "aria-valuemin": 0,
      "aria-valuemax": 100,
    },
    h("span", { class: "progress-fill" }),
  );
}

/* tool.started → tool.heartbeat/engine.progress → tool.finished. */
function toolCard({ label, name, args = "", readOnly }) {
  const timeNode = h("span", { class: "tool-time mono" }, "0.0 s");
  const card = h(
    "div",
    { class: "tool", dataset: { state: "run" } },
    h("div", { class: "tool-head" }, icon("loader", "spin"), h("span", { class: "tool-label" }, label), timeNode),
    h("span", { class: "tool-name mono" }, `mcp__studio__${name}${readOnly ? " · read-only" : ""}`),
  );
  feedPush(card);
  editorTerminal.line(`● mcp__studio__${name}(${args})`, "tool");
  const started = performance.now();
  const timer = setInterval(() => (timeNode.textContent = `${((performance.now() - started) / 1000).toFixed(1)} s`), 100);
  card.stopTimer = () => clearInterval(timer);
  app.running.openCards.add(card);

  return {
    card,
    progress(fraction, leftText, rightText) {
      let wrap = $(".tool-progress", card);
      if (!wrap) {
        wrap = h("div", { class: "tool-progress" }, progressBar(label), h("div", { class: "tool-progress-meta mono" }, h("span"), h("span")));
        card.append(wrap);
      }
      $(".progress", wrap).setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
      $(".progress-fill", wrap).style.setProperty("--v", fraction);
      const [leftNode, rightNode] = $$(".tool-progress-meta span", wrap);
      leftNode.textContent = leftText;
      rightNode.textContent = rightText;
    },
    append(node) {
      card.append(node);
      feed.scrollTop = feed.scrollHeight;
    },
    finish(summary) {
      card.stopTimer();
      app.running?.openCards.delete(card);
      card.dataset.state = "done";
      $(".tool-head .icon", card).replaceWith(icon("check"));
      $(".progress", card)?.setAttribute("data-state", "done");
      if (summary) {
        card.append(h("p", { class: "tool-summary" }, summary));
        editorTerminal.line(`  └ ${summary}`, "result");
      }
      feed.scrollTop = feed.scrollHeight;
    },
  };
}

async function runProgress(tool, ms, signal, describe) {
  const steps = 20;
  const label = $(".tool-label", tool.card).textContent;
  for (let step = 1; step <= steps; step += 1) {
    await wait(ms / steps, signal);
    const fraction = step / steps;
    tool.progress(fraction, describe(fraction), `${Math.round(fraction * 100)}%`);
    $("#agent-status-text").textContent = `${label} ${Math.round(fraction * 100)}%`;
  }
}

/* retry (system/api_retry): a countdown the user can see, not a frozen spinner. */
async function retryBanner(seconds, signal) {
  const countNode = h("span", { class: "mono" }, `Retrying in ${seconds} s`);
  const message = h("p", {}, h("strong", {}, "Rate limited."), " ", countNode, " · attempt 2 of 10");
  const bar = h("div", { class: "progress" }, h("span", { class: "progress-fill" }));
  feedPush(h("div", { class: "notice banner" }, icon("clock"), h("div", {}, message, bar)));
  editorTerminal.line(`API retry · rate limited · waiting ${seconds} s (attempt 2 of 10)`, "warn");
  for (let left = seconds; left > 0; left -= 1) {
    countNode.textContent = `Retrying in ${left} s`;
    $(".progress-fill", bar).style.setProperty("--v", (seconds - left) / seconds);
    setAgentStatus("running", `Waiting on rate limit · ${left} s`);
    await wait(1000, signal);
  }
  message.replaceChildren(h("strong", {}, "Back on."), " The request went through on attempt 2.");
  bar.remove();
  editorTerminal.line("API retry · went through on attempt 2", "ok");
}

/* question.asked and approval.requested share one card. An approval leads with server-derived facts;
   Claude's own reason is shown second, quoted, because it can carry injected text (plan §6.8, §6.11). */
function askCard({ question, options, facts, claudeSays }, signal) {
  const actions = h("div", { class: "ask-actions" });
  const card = h(
    "div",
    { class: "ask" },
    h("p", { class: "ask-title" }, question),
    facts
      ? h(
          "ul",
          { class: "ask-facts mono" },
          facts.map((fact) => h("li", {}, fact)),
        )
      : null,
    claudeSays ? h("blockquote", { class: "ask-quote" }, h("span", { class: "label" }, "Claude says"), h("p", {}, claudeSays)) : null,
    actions,
  );
  feedPush(card);
  editorTerminal.line(`? ${question}`, "warn");
  editorTerminal.line(`  ${options.map((option, index) => `[${index + 1}] ${option.label}`).join("   ")}`, "out");
  setAgentStatus("running", "Waiting for you");
  return new Promise((resolve, reject) => {
    options.forEach((option, index) => {
      const button = h(
        "button",
        {
          type: "button",
          class: `btn btn-sm ${index === 0 ? "btn-accent" : ""}`,
        },
        option.label,
      );
      button.addEventListener("click", () => {
        card.dataset.resolved = "true";
        card.append(h("p", { class: "ask-answer" }, `You chose: ${option.label}`));
        editorTerminal.line(`› ${option.label}`, "cmd");
        resolve(option.value);
      });
      actions.append(button);
    });
    $("button", actions).focus({ preventScroll: true });
    signal.addEventListener(
      "abort",
      () => {
        card.dataset.resolved = "true";
        card.append(h("p", { class: "ask-answer" }, "Cancelled."));
        reject(new Stopped());
      },
      { once: true },
    );
  });
}

function addUsage(dollars) {
  app.usageTurn += dollars;
  app.usageProject += dollars;
  updateUsage();
}

/* API key and cloud show a dollar estimate; the terminal sign-in shows plan usage only (plan §6.13). */
function updateUsage() {
  const meter = $("#usage-meter");
  const isPlan = app.credential === "cli";
  const usedFraction = isPlan ? Math.min(0.34 + app.usageTurn * 0.25, 1) : Math.min(app.usageProject / 5, 1);
  $("#usage-figure").textContent = isPlan
    ? `Plan session ${Math.round(usedFraction * 100)}% used · resets in 3 h 12 min`
    : `≈ $${app.usageTurn.toFixed(2)} this turn · ≈ $${app.usageProject.toFixed(2)} project`;
  meter.setAttribute("aria-label", isPlan ? "Plan session limit used" : "Project budget used");
  meter.setAttribute("aria-valuenow", String(Math.round(usedFraction * 100)));
  $(".meter-fill", meter).style.setProperty("--v", usedFraction);
  $("#usage-help").textContent = isPlan
    ? "Counts against your Claude plan. No dollar figure, because that's not what you pay."
    : "Estimate against a $5.00 project cap, not billing data. Actual billing is in your Claude Console.";
}
