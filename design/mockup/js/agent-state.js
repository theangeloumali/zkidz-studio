// Created by The Angelo Umali.
"use strict";

/* Screen 3: Stop, reset, the composer and the prototype's agent-state controls. */

/* Stop = interrupt(): the turn ends cleanly and the session stays resumable (plan §6.12). */
function stopRun(reason) {
  if (!app.running) return;
  app.running.openCards.forEach((card) => {
    card.stopTimer();
    card.dataset.state = "error";
    $(".tool-head .icon", card).replaceWith(icon("x"));
    card.append(h("p", { class: "tool-summary" }, "Stopped. Any engine job it started was cancelled."));
  });
  editorTerminal.line("  └ interrupted", "warn");
  app.running.controller.abort();
  systemRow(reason);
  setAgentStatus("idle", "Stopped");
  finishRun();
}

$("#stop-btn").addEventListener("click", () => stopRun("stopped by you · session saved, send a message to resume"));

const BLOCKING_STATES = ["signed-out", "key-rejected"];

$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = $("#prompt").value.trim();
  if (!prompt || app.running || BLOCKING_STATES.includes(app.agentState)) return;
  runAgent(prompt);
});

$("#prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
});

function resetEditor(clips = DEFAULT_CLIPS) {
  stopRun("reset");
  setPlaying(false);
  feed.replaceChildren();
  startTerminalSession();
  $("#feed-empty").hidden = BLOCKING_STATES.includes(app.agentState);
  Object.assign(app, {
    cutsApplied: false,
    captionsApplied: false,
    cuesApplied: [],
    time: 0,
    usageTurn: 0,
  });
  setAgentStatus("idle", "Idle");
  setIconLabel($("#send-btn"), "arrow-up", "Start editing");
  renderBin(clips);
  drawTimeline();
  resetVersions();
  updateUsage();
}

function applyAgentState(state) {
  app.agentState = state;
  const isBlocked = BLOCKING_STATES.includes(state);
  if (isBlocked) stopRun(state === "signed-out" ? "Claude Code signed out · paused" : "API key rejected · paused");
  $("#auth-block-key").hidden = state !== "key-rejected";
  $("#auth-block-cli").hidden = state !== "signed-out";
  $("#composer").hidden = isBlocked;
  feed.hidden = isBlocked;
  $("#feed-empty").hidden = isBlocked || feed.children.length > 0;
  if (state === "signed-out") editorTerminal.line("Not signed in. Type /login to sign in.", "warn");
  if (isBlocked) setAgentStatus("error", state === "signed-out" ? "Signed out" : "Key rejected");
  else if (!app.running) setAgentStatus("idle", "Idle");
  if (state === "rate-limited" && !app.running) retryBanner(12, new AbortController().signal).then(() => setAgentStatus("idle", "Idle"));
  updateCredentialChip();
}

wireSegment("state", applyAgentState);

/* Signing in again happens in the terminal itself, with Claude Code's own /login. */
$("#auth-open-terminal").addEventListener("click", async () => {
  showAgentView("terminal");
  await runTerminalSignIn(editorTerminal);
  setRadioGroup($$("[data-state]"), $('[data-state="normal"]'));
  applyAgentState("normal");
  toast("Signed in (shown by Claude Code).");
});

/* Contract check from plan §9.1: hostile agent text must render literally in the feed, the terminal and the timeline. */
const HOSTILE_TEXT = "</script><img src=x onerror=alert(1)>";
$("#proto-hostile").addEventListener("click", () => {
  const ownsRun = !app.running;
  if (ownsRun) app.running = { controller: new AbortController(), openCards: new Set() };
  narrate(HOSTILE_TEXT, app.running.controller.signal);
  toolCard({ label: HOSTILE_TEXT, name: "add_cue", args: HOSTILE_TEXT }).finish(HOSTILE_TEXT);
  block($("#lane-cues"), "blk-cue", 100, 110, HOSTILE_TEXT, true);
  if (ownsRun) app.running = null;
  location.hash = "#editor";
  toast("Injected text shown as text. No image loaded, no script ran.");
});

$("#proto-reset").addEventListener("click", () => {
  resetEditor();
  toast("Editor reset.");
});
