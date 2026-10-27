// Created by The Angelo Umali.
// A cover is a settled hookTitle: covers take stills with --settled, which refuses a time before the title has landed.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { hookTitle } = require("../components/titles");
const { stillTimesFor, unsettledStills } = require("../render");

// ep 12's Cover B cue: taken 0.92 s in, its rule was still drawing on and the node's ring sat at the rule's end.
const COVER = { kind: "hookTitle", seed: 7, kicker: "FREELANCING WITH AI", lines: ["Me, or my", "employers?"], accentLine: 1 };

test("a hook title lands after its last word and its rule's first ring", () => {
  const landed = hookTitle.landed(COVER);
  assert.ok(landed > 0.92 && landed < 2, `landed at ${landed} s`);
});

test("a still before a title lands is refused with the first time that works", () => {
  const placed = [{ kind: "hookTitle", start: 37.38, stop: 39.82, landed: 37.38 + hookTitle.landed(COVER) }];
  const [problem] = unsettledStills(placed, [38.3]);
  assert.match(problem, /^38\.3 s catches the hookTitle before it lands at 3\d\.\d\d s: take it at 3\d\.\d s or later$/);
  assert.deepEqual(unsettledStills(placed, [placed[0].landed + 0.05]), []);
  assert.deepEqual(unsettledStills([{ kind: "keyword", start: 37, stop: 40 }], [38.3]), []);
});

test("a settled hook title rings its node once instead of pulsing it", () => {
  const repeats = (settled) => hookTitle.render(COVER, { duration: 8, settled }).motion.filter((spec) => spec.to?.repeat);
  assert.ok(repeats(false).length > 0);
  assert.deepEqual(repeats(true), []);
});

// Codex review: an auto preview drew a still per cue and kept only the first four.
test("auto still times are capped before any still is drawn", () => {
  const placed = [5, 1, 9, 3, 7].map((start) => ({ kind: "keyword", start, stop: start + 1 }));
  assert.deepEqual(stillTimesFor(placed, ["auto"], 2), [1.68, 3.68]); // each just before its cue's exit
  assert.equal(stillTimesFor(placed, ["auto"]).length, 5);
  assert.deepEqual(stillTimesFor(placed, ["4", "2"], 1), [4, 2]);
});
