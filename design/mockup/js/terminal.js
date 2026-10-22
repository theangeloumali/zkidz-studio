// Created by The Angelo Umali.
"use strict";

/* A simulated terminal: neutral chrome, brand mono, one line per <li>. Every line is text, never markup.
   It stands in for the user's own `claude` running in a real PTY; it draws none of Claude Code's own visuals. */

const TERMINAL_LINE_KINDS = ["cmd", "out", "tool", "result", "say", "warn", "ok", "dim"];
const TERMINAL_MAX_LINES = 400;

function createTerminal(body) {
  return {
    line(text, kind = "out") {
      const row = h(
        "li",
        {
          class: `term-line term-${TERMINAL_LINE_KINDS.includes(kind) ? kind : "out"}`,
        },
        text,
      );
      body.append(row);
      while (body.children.length > TERMINAL_MAX_LINES) body.firstElementChild.remove();
      body.scrollTop = body.scrollHeight;
      return row;
    },
    clear() {
      body.replaceChildren();
    },
  };
}

const editorTerminal = createTerminal($("#editor-term-body"));
const PROJECT_PROMPT = `~/ZKS_HOME/projects/${PROJECT_SLUG} $`;

function startTerminalSession() {
  editorTerminal.clear();
  editorTerminal.line(`${PROJECT_PROMPT} claude`, "cmd");
  editorTerminal.line(`cwd ${PROJECT_SLUG} · plugin studio (22 tools, 6 skills) · settings: none`, "dim");
}

/* Activity and Terminal are two views of one run; switching is instant (frequent action, no motion). */
function showAgentView(view) {
  $$('[role="tab"][data-view]').forEach((tab) => {
    const isActive = tab.dataset.view === view;
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });
  $("#panel-activity").hidden = view !== "activity";
  $("#panel-terminal").hidden = view !== "terminal";
}

$$('[role="tab"][data-view]').forEach((tab, index, tabs) => {
  tab.addEventListener("click", () => showAgentView(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    showAgentView(next.dataset.view);
  });
});
