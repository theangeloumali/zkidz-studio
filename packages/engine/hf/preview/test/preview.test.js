// Created by The Angelo Umali.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { buildPreview, captionCues } = require("..");

const FRAMES = 300;
const EDL = { fps_num: 30, fps_den: 1, frames: FRAMES, segments: [{ in: 0, out: FRAMES, target: 0, zoom: 1, cut_after: "pause" }], bleeps: [], cutaways: [] };
const HOSTILE = "</script><img src=x onerror=alert(1)>";
const PHRASES = [
  { id: 0, at: 0.5, end: 1.5, reel: null, text: "kumusta" },
  { id: 1, at: 1.6, end: 2.4, reel: null, text: "tayo" },
];

function workWith({ cues, captions }) {
  const work = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hf-preview-")), "work");
  const write = (relative, content) => {
    fs.mkdirSync(path.dirname(path.join(work, relative)), { recursive: true });
    fs.writeFileSync(path.join(work, relative), JSON.stringify(content));
  };
  write("preview/v1.edl.json", EDL); // the server's preview EDL, never the render's edl/v1.json
  if (cues) write("cues/v1.json", cues);
  if (captions) {
    write("captions/v1.json", captions);
    write("captions/v1.phrases.json", PHRASES);
  }
  return work;
}

const htmlOf = (dir) => fs.readFileSync(path.join(dir, "index.html"), "utf8");

test("the main cue sheet and the captions build one composition, timed like the renderer's", () => {
  const work = workWith({ cues: [{ kind: "keyword", at: 3, end: 5, text: "word" }], captions: [{ ids: [0, 1], en: "How are we" }] });
  const { dir, placed } = buildPreview({ work, video: "v1" });
  const caption = placed.find((clip) => clip.kind === "caption");
  assert.deepEqual(placed.map((clip) => clip.text).sort(), ["How are we", "word"]);
  assert.equal(caption.start, 0.5);
  assert.equal(dir, path.join(work, "preview", "v1"));
});

test("the page runs under a script-src 'self' policy: no inline script or style element", () => {
  const { dir } = buildPreview({ work: workWith({ cues: [{ kind: "keyword", at: 1, end: 3, text: "word" }] }), video: "v1" });
  const html = htmlOf(dir);
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>/g)];
  assert.deepEqual(inlineScripts, []);
  assert.equal(/<style\b/.test(html), false);
  assert.match(html, /<link rel="stylesheet" href="preview\.css"/);
  assert.match(html, /<script src="preview\.js"><\/script>/);
  for (const file of ["preview.css", "preview.js", "vendor/gsap.min.js", "vendor/CustomEase.min.js"]) assert.ok(fs.existsSync(path.join(dir, file)), file);
});

test("inline styles ship as data-style, so the CSP blocks none of them while the page parses", () => {
  const text = 'say style="color:red" here';
  const { dir } = buildPreview({ work: workWith({ cues: [{ kind: "keyword", at: 1, end: 3, text }] }), video: "v1" });
  const html = htmlOf(dir);
  assert.equal(/<[a-zA-Z][^>]*\sstyle="/.test(html), false);
  assert.match(html, /\sdata-style="/);
  assert.ok(html.includes("style=&quot;color:red&quot;"), "cue text keeps its literal words");
});

test("clips off the seeked time skip layout and paint until player.js marks them live", () => {
  const { dir } = buildPreview({ work: workWith({ cues: [{ kind: "keyword", at: 1, end: 3, text: "word" }] }), video: "v1" });
  const css = fs.readFileSync(path.join(dir, "preview.css"), "utf8");
  assert.match(css, /\.clip:not\(\.live\) \{ visibility: hidden; content-visibility: hidden; \}/);
});

test("no frames are rendered: the folder holds the page and its assets only", () => {
  const { dir } = buildPreview({ work: workWith({ cues: [{ kind: "keyword", at: 1, end: 3, text: "word" }] }), video: "v1" });
  const files = fs.readdirSync(dir, { recursive: true }).map(String);
  assert.deepEqual(
    files.filter((file) => /^\d+\.png$/.test(path.basename(file)) || file.startsWith("frames")),
    [],
  );
});

test("hostile cue and caption text is drawn as text, never parsed as markup", () => {
  const work = workWith({ cues: [{ kind: "keyword", at: 3, end: 5, text: HOSTILE }], captions: [{ ids: [0, 1], en: HOSTILE }] });
  const { dir, placed } = buildPreview({ work, video: "v1" });
  const html = htmlOf(dir);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("<!--"), false);
  assert.ok(html.includes("&lt;img"), "the text is in the page, escaped");
  assert.deepEqual(
    placed.map((clip) => clip.text),
    [HOSTILE, HOSTILE],
  );
});

test("a caption's own plate bottom reaches the preview, as emit_cues carries it to the render", () => {
  const work = workWith({ captions: [{ ids: [0, 1], en: "Lower", bottom: 1750 }] });
  assert.deepEqual(captionCues(work, "v1"), [{ kind: "caption", at: 0.5, end: 2.4, text: "Lower", bottom: 1750 }]);
});

test("a video with no cues or captions yet still builds an empty, seekable page", () => {
  const { placed, dir } = buildPreview({ work: workWith({}), video: "v1" });
  assert.deepEqual(placed, []);
  assert.match(htmlOf(dir), /data-duration="10\.000000000"/);
});

test("an image cue is left out of the preview with a warning, so no file path reaches the page", () => {
  const work = workWith({ cues: [{ kind: "backdrop", at: 1, end: 3, src: "media/secret.png" }] });
  const { placed, warnings } = buildPreview({ work, video: "v1" });
  assert.deepEqual(placed, []);
  assert.match(warnings.join("\n"), /backdrop/);
});

test("a rebuild replaces the page in place", () => {
  const work = workWith({ cues: [{ kind: "keyword", at: 1, end: 3, text: "first" }] });
  buildPreview({ work, video: "v1" });
  fs.writeFileSync(path.join(work, "cues", "v1.json"), JSON.stringify([{ kind: "keyword", at: 1, end: 3, text: "second" }]));
  const { dir } = buildPreview({ work, video: "v1" });
  assert.ok(htmlOf(dir).includes("second"));
  assert.equal(htmlOf(dir).includes("first"), false);
});

test("the video id cannot climb out of the work folder", () => {
  assert.throws(() => buildPreview({ work: workWith({}), video: "../v1" }), /video id/);
});
