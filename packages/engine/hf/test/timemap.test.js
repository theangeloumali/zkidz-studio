// Created by The Angelo Umali.
// A cue authored a few frames after a cut starts on the cut: a cover 0.08 s late flashed bare footage at a reel's open.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTimemap } = require("../overlay/timemap");

const FPS = 30000 / 1001;
const edl = (reel) => ({
  fps_num: 30000,
  fps_den: 1001,
  frames: 600,
  reel,
  cutaways: [],
  bleeps: [],
  segments: [
    { in: 30191, out: 30491, target: 0 },
    { in: 31756, out: 32056, target: 300 },
  ],
});
const map = (cues, reel = false) => createTimemap(edl(reel), []).mapCues(cues);
const at = (frame) => frame / FPS;

for (const reel of [false, true]) {
  test(`${reel ? "a reel" : "a full edit"}: a cue 2 frames after a cut starts on it, one 10 frames after keeps its time`, () => {
    const [paper, word] = map(
      [
        { kind: "paperScene", at: at(30193), end: at(30400) },
        { kind: "bigWord", at: at(31766), end: at(31900) },
      ],
      reel,
    );
    assert.equal(paper.start, 0);
    assert.ok(Math.abs(word.start - (300 + 10) / FPS) < 1e-9);
  });
}

test("a pin keeps its word when its cue starts on the cut", () => {
  const [chips] = map([{ kind: "chipRail", at: at(30193), end: at(30400), chips: [{ text: "HOW LONG", at: 1 }] }]);
  assert.ok(Math.abs(chips.chips[0].at - (2 / FPS + 1)) < 1e-6);
});

test("word-caption states keep their own starts after a cut, so two never overlap", () => {
  const [first, second] = map([
    { kind: "caption", style: "words", at: at(31756), end: at(31758) },
    { kind: "caption", style: "words", at: at(31758), end: at(31770) },
  ]);
  assert.ok(Math.abs(second.start - (300 + 2) / FPS) < 1e-9);
  assert.ok(first.stop <= second.start + 1e-9);
});
