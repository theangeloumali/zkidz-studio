// Created by The Angelo Umali.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { loadCueSheet } = require("../cues");

function workWith(files) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "hf-cues-"));
  fs.mkdirSync(path.join(work, "cues"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(work, "cues", name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return work;
}

const HOOK = { kind: "hookTitle", at: 0.5, end: 3, lines: ["One"] };
const KEYWORD = { kind: "keyword", at: 4, end: 5, text: "word" };

test("cue files are JSON arrays read in order, each one appended", () => {
  const work = workWith({ "v1.json": [HOOK], "v1-cc.json": [{ kind: "caption", at: 1, end: 2, text: "hi" }] });
  assert.deepEqual(
    loadCueSheet(work, ["v1", "v1-cc"]).map((cue) => cue.kind),
    ["hookTitle", "caption"],
  );
});

test("a reel override is a patch list that removes and replaces by kind and at", () => {
  const work = workWith({
    "v1.json": [HOOK, KEYWORD],
    "v1r.json": [
      { op: "remove", match: { kind: "keyword", at: 4 } },
      { op: "replace", match: { kind: "hookTitle", at: 0.5 }, cue: { ...HOOK, lines: ["Reel"] } },
    ],
  });
  assert.deepEqual(loadCueSheet(work, ["v1", "v1r"]), [{ ...HOOK, lines: ["Reel"] }]);
});

test("a patch that matches no cue fails instead of silently doing nothing", () => {
  const work = workWith({ "v1.json": [HOOK], "v1r.json": [{ op: "remove", match: { kind: "keyword", at: 9 } }] });
  assert.throws(() => loadCueSheet(work, ["v1", "v1r"]), /cues\/v1r\.json: no keyword at 9/);
});

test("a file mixing cues and patches is refused", () => {
  const work = workWith({ "v1.json": [HOOK, { op: "remove", match: { kind: "hookTitle", at: 0.5 } }] });
  assert.throws(() => loadCueSheet(work, ["v1"]), /cues\/v1\.json mixes cues and patches/);
});

test("a JS cue sheet is never run: only the .json file is read", () => {
  const marker = path.join(os.tmpdir(), `hf-cues-ran-${process.pid}`);
  const work = workWith({ "v1.js": `require("fs").writeFileSync(${JSON.stringify(marker)}, "x"); const CUE_SHEET = [];` });
  assert.throws(() => loadCueSheet(work, ["v1"]), /cues\/v1\.json is missing/);
  assert.equal(fs.existsSync(marker), false);
});

test("invalid JSON and a non-array file name the file", () => {
  assert.throws(() => loadCueSheet(workWith({ "v1.json": "[{" }), ["v1"]), /cues\/v1\.json is not valid JSON/);
  assert.throws(() => loadCueSheet(workWith({ "v1.json": { kind: "keyword" } }), ["v1"]), /cues\/v1\.json must hold an array/);
});

test("a cue name cannot leave the cues folder", () => {
  assert.throws(() => loadCueSheet(workWith({}), ["../edl/v1"]), /not a cue file name/);
});

function inJob(snapshot, run) {
  const previous = process.env.ZKS_SPECS;
  process.env.ZKS_SPECS = snapshot;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.ZKS_SPECS;
    else process.env.ZKS_SPECS = previous;
  }
}

function withDerived(work, files) {
  fs.mkdirSync(path.join(work, "derived", "cues"), { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(work, "derived", "cues", name), JSON.stringify(content));
  return work;
}

test("a job draws the cue sheet from its start snapshot (ZKS_SPECS), and derived sheets from the engine's own folder", () => {
  const work = withDerived(workWith({ "v1.json": [KEYWORD] }), { "v1-cc.json": [{ kind: "caption", at: 1, end: 2, text: "hi" }] });
  inJob(workWith({ "v1.json": [HOOK] }), () =>
    assert.deepEqual(
      loadCueSheet(work, ["v1", "v1-cc"]).map((cue) => cue.kind),
      ["hookTitle", "caption"],
    ),
  );
});

test("in a job, a sheet the snapshot lacks is missing, never read live from work/cues", () => {
  const work = workWith({ "v1.json": [KEYWORD], "v1-cc.json": [{ kind: "caption", at: 1, end: 2, text: "planted" }] });
  inJob(workWith({}), () => {
    assert.throws(() => loadCueSheet(work, ["v1"]), /cues\/v1\.json is missing/);
    assert.throws(() => loadCueSheet(work, ["v1-cc"]), /cues\/v1-cc\.json is missing/);
  });
});

test("outside a job, an authored sheet in work/cues wins over the engine's placeholder", () => {
  const work = withDerived(workWith({ "v1.json": [KEYWORD] }), { "v1.json": [] });
  assert.deepEqual(loadCueSheet(work, ["v1"]), [KEYWORD]);
});
