// Created by The Angelo Umali.
// Caption plates are cached per caption: a re-cut moves every caption's time, but only a changed caption is re-snapshotted.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { captionMarkup, plateKey, platesToDraw } = require("../render");

const svg = (fill) => `<div class="cue-out"><svg class="ink"><text x="332.55" y="1750" fill="${fill}">How</text></svg></div></div>`;
const page = (start, fill) =>
  `<body>\n      <div id="c3" class="clip" data-start="${start}" data-duration="0.13" data-track-index="3">${svg(fill)}\n` +
  `      <div id="c4" class="clip" data-start="1.02" data-duration="0.3" data-track-index="3">${svg("#FFFFFF")}\n</body>`;

test("a caption moved by a re-cut keeps its plate key", () => {
  const before = captionMarkup(page("0.89", "#FFFFFF"));
  const after = captionMarkup(page("4.21", "#FFFFFF"));
  assert.deepEqual(Object.keys(before), ["c3", "c4"]);
  assert.equal(plateKey("code", after.c3), plateKey("code", before.c3));
});

test("a cue added earlier in the sheet renumbers the shadow filter, not the plate", () => {
  const shadowed = (seed) =>
    captionMarkup(`      <div id="c3" class="clip" data-start="1">${svg("#FFFFFF").replace("<svg", `<svg filter="url(#s${seed}-shadow)"`)}\n`).c3;
  assert.equal(plateKey("code", shadowed(9052)), plateKey("code", shadowed(9060)));
});

test("a caption that turns to ink over paper, or new renderer code, draws a new plate", () => {
  // onCover and the line layout read other cues, so the drawn markup, not the caption's own fields, is the key.
  const white = captionMarkup(page("0.89", "#FFFFFF")).c3;
  const ink = captionMarkup(page("0.89", "#172230")).c3;
  assert.notEqual(plateKey("code", ink), plateKey("code", white));
  assert.notEqual(plateKey("other code", white), plateKey("code", white));
});

test("only plates missing from the cache are drawn", () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "zks-plates-"));
  try {
    fs.writeFileSync(path.join(cache, "aaa.png"), "");
    assert.deepEqual(platesToDraw(["aaa", "bbb", "aaa", "ccc"], cache), [1, 3]);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});
