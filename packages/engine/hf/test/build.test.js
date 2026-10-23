// Created by The Angelo Umali.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

// build.js reads ZKS_WORK when it loads; cue images resolve from the work dir's parent (the repo root).
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "hf-build-"));
const WORK = path.join(ROOT, "work");
process.env.ZKS_WORK = WORK;
const { build } = require("../build");
const { canvasBrand } = require("../brand/canvas");

const FRAMES = 300;
const EDL = { fps_num: 30, fps_den: 1, frames: FRAMES, segments: [{ in: 0, out: FRAMES, target: 0, zoom: 1, cut_after: "pause" }], bleeps: [], cutaways: [] };
const HOOK = { kind: "hookTitle", at: 0.5, end: 3, kicker: "Kicker", lines: ["One", "Two"], accentLine: 1, intro: true };
const HOSTILE = "</script><img src=x onerror=alert(1)><!--";

function sheet(video, cues) {
  for (const sub of ["edl", "cues"]) fs.mkdirSync(path.join(WORK, sub), { recursive: true });
  fs.writeFileSync(path.join(WORK, "edl", `${video}.json`), JSON.stringify(EDL));
  fs.writeFileSync(path.join(WORK, "cues", `${video}.json`), JSON.stringify(cues));
}
const htmlOf = (dir) => fs.readFileSync(path.join(dir, "index.html"), "utf8");

test("a JSON cue sheet builds with the zkidz theme by default, brand intro included", () => {
  sheet("plain", [HOOK, { kind: "keyword", at: 4, end: 6, text: "word" }]);
  const { placed, intro } = build("plain");
  assert.deepEqual(
    placed.map((cue) => cue.kind),
    ["hookTitle", "keyword"],
  );
  assert.ok(intro && fs.existsSync(path.join(intro.dir, "index.html")));
});

test("the minimal theme draws its own palette and never adds the brand intro", () => {
  sheet("lean", [HOOK]);
  const { dir, intro } = build("lean", { theme: "minimal" });
  assert.equal(intro, null);
  assert.equal(fs.existsSync(path.join(WORK, "hf", "lean.intro")), false);
  assert.ok(htmlOf(dir).includes("#111418"));
  assert.equal(canvasBrand().scope.BRAND.ink, "#111418");
});

test("a kind outside the theme's manifest fails the build", () => {
  sheet("staged", [{ kind: "pipeline", at: 1, end: 4, labels: ["a", "b", "c"] }]);
  assert.throws(() => build("staged", { theme: "minimal" }), /theme minimal does not draw pipeline/);
});

test("hostile cue text is drawn as text, never as markup", () => {
  sheet("hostile", [
    { kind: "keyword", at: 1, end: 3, text: HOSTILE },
    { kind: "caption", at: 3, end: 5, text: HOSTILE },
  ]);
  const html = htmlOf(build("hostile").dir);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("<!--"), false);
});

test("a cue image's copied name cannot break out of its src attribute", () => {
  const images = path.join(ROOT, "media");
  fs.mkdirSync(images, { recursive: true });
  const name = 'a" onload="x.png';
  fs.copyFileSync(path.join(__dirname, "..", "brand", "zkidz-dev-logo.png"), path.join(images, name));
  sheet("image", [{ kind: "backdrop", at: 1, end: 3, src: `media/${name}` }]);
  const html = htmlOf(build("image").dir);
  assert.equal(/src="[^"]*"\s+onload=/.test(html), false);
  assert.match(html, /src="media\/0-a__onload__x\.png"/);
});
