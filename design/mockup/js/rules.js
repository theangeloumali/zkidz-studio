// Created by The Angelo Umali.
"use strict";

/* Rules panel: user-written standing instructions, 500 characters each. Rules come only from a user click, never from the agent. */

const RULE_MAX_CHARS = 500;
const projectRules = [
  "Captions go at the bottom, clear of my mouth and chin.",
  "Never blur my family. Ask before adding any blur to home footage.",
  "Keep every hook title under six words.",
];

function renderRules() {
  $("#rule-list").replaceChildren(
    ...projectRules.map((ruleText, index) => {
      const deleteButton = h(
        "button",
        {
          type: "button",
          class: "icon-btn icon-btn-sm",
          "aria-label": `Delete rule ${index + 1}`,
        },
        icon("trash"),
      );
      deleteButton.addEventListener("click", () => {
        projectRules.splice(index, 1);
        renderRules();
        toast("Rule deleted.");
      });
      return h("li", { class: "rule" }, h("span", { class: "rule-number mono" }, String(index + 1)), h("p", { class: "rule-text" }, ruleText), deleteButton);
    }),
  );
  $("#rule-empty").hidden = projectRules.length > 0;
}

$("#rule-text").addEventListener("input", (event) => {
  $("#rule-count").textContent = `${event.target.value.length} / ${RULE_MAX_CHARS}`;
});

$("#rule-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const field = $("#rule-text");
  const ruleText = field.value.trim().slice(0, RULE_MAX_CHARS);
  if (!ruleText) {
    field.focus();
    return;
  }
  projectRules.push(ruleText);
  field.value = "";
  $("#rule-count").textContent = `0 / ${RULE_MAX_CHARS}`;
  renderRules();
  toast("Rule added. The agent reads it on its next turn.");
});

renderRules();
