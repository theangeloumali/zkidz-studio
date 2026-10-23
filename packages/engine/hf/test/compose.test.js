// Created by The Angelo Umali.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { composeDocument } = require("../compose");

// A component that copies the cue's text into a tween, so it lands in the hf-tweens JSON script.
const echo = { render: (cue) => ({ html: "", motion: [{ target: ".x", to: { attr: { "data-text": cue.text } }, at: 0 }], exit: [] }) };
const HOSTILE = "</script><img src=x onerror=alert(1)> <!-- <script>";

function documentWith(text) {
  const edl = { fps_num: 30, fps_den: 1, frames: 60, segments: [] };
  return composeDocument({ edl, cues: [{ kind: "echo", start: 0, stop: 1, text }], registry: { echo }, compositionId: "t", css: "" }).html;
}

test("cue text inside the JSON scripts cannot close the script or open a comment", () => {
  const html = documentWith(HOSTILE);
  const scriptTags = (html.match(/<script\b/gi) ?? []).length;
  assert.equal((html.match(/<\/script/gi) ?? []).length, scriptTags);
  assert.equal(html.includes("<!--"), false);
  assert.equal(html.includes("<img"), false);
});

test("the escaped JSON still parses back to the exact text", () => {
  const html = documentWith(HOSTILE);
  const tweens = JSON.parse(html.match(/<script type="application\/json" id="hf-tweens">([^<]*)<\/script>/)[1]);
  assert.equal(tweens[0].to.attr["data-text"], HOSTILE);
});
