// Created by The Angelo Umali.
// Builds the brand HyperFrames composition for one edit: loads the JSON cue files in order (cues.js), maps them through
// the EDL with the canvas page's timemap, and writes <WORK>/hf/<target>/ (index.html, cues.json, assets) in a theme pack's look.
// Usage (work dir as cwd, or ZKS_WORK): node <engine>/hf/build.js v4r:v4+v4r+v4-cc [--events] [--guides] [--layer behind] [--theme id]
//   --events → also edl/<video>.sfx.json for sfx.py (same schema as render-overlays.js --events), from every cue in both layers
//   --layer behind → hf/<target>.behind/: only the cues with depth "behind" (never captions), drawn under the person matte;
//   the normal build skips them
//   --theme id → themes/<id>/ (default zkidz): palette, type, boil, intro, and the kinds it draws
// A hookTitle with `intro: true` also gets the brand pre-roll (when the theme has an intro): hf/<target>.intro/, and an `intro` block in the sfx file
// that sfx.py and render_final.py read.
const fs = require("fs");
const path = require("path");
const { createTimemap, sfxEvents } = require("./overlay/timemap");
const { loadCueSheet } = require("./cues");
const { loadTheme, DEFAULT_THEME } = require("./theme");
const { composeDocument } = require("./compose");
const { REGISTRY } = require("./components");
const { canvasBrand } = require("./brand/canvas");
const { fontAssets, fontFaceCss } = require("./brand/fonts");
const { redesign } = require("./fx/sound");
const { INTRO, LAYOUTS, introFrames, brandIntro, brandSplit } = require("./components/intro");

const WORK = process.env.ZKS_WORK || process.cwd();
// Cue images (a backdrop, a cutout) are repo-relative like a cut spec's inserts; an absolute path still wins.
const REPO = path.dirname(WORK);
const LAYERS = ["front", "behind"];
const vendor = (file) => require.resolve(`gsap/dist/${file}`, { paths: [__dirname] });
const ASSETS = {
  ...fontAssets(),
  "brand/zkidz-dev-logo.png": path.join(__dirname, "brand", "zkidz-dev-logo.png"),
  "vendor/gsap.min.js": vendor("gsap.min.js"),
  "vendor/CustomEase.min.js": vendor("CustomEase.min.js"),
};
const CSS = `${fontFaceCss()}
${fs.readFileSync(path.join(__dirname, "brand", "brand.css"), "utf8")}`;
const isKnownKind = (kind) => Object.hasOwn(REGISTRY, kind);

// The edit's brand pre-roll, from its one hookTitle with `intro: true`. It goes in when that hook ends, or after a vlog-style
// cold open where the hook's `introAt` pin says it ends (never before the hook has gone): sfx.py puts the insert at the
// first pause after that and writes it to vN.sfx.json (intro.at).
function introOf(cues, edl) {
  const hooks = cues.filter((cue) => cue.kind === "hookTitle" && cue.intro);
  if (!hooks.length) return null;
  if (hooks.length > 1) throw new Error(`${hooks.length} hookTitles have intro: true; an edit has one brand intro`);
  const [hook] = hooks;
  const after = hook.introAt === undefined ? hook.stop : Math.max(hook.stop, hook.start + hook.introAt);
  return { ...prerollAt(edl.fps_num / edl.fps_den), hookEnd: after };
}

// One frame past INTRO.split, when the halves are hidden: the split ends clear, whatever the frame rate.
const splitFrames = (rate) => Math.ceil(INTRO.split * rate) + 1;
const splitClip = (rate, layout, startFrame = 0) => ({
  kind: "brandSplit",
  layout,
  start: startFrame / rate,
  stop: (startFrame + splitFrames(rate)) / rate,
  seed: 0,
});

// Speech and footage set these kinds' times; every other card after the hook may wait for the insert.
const LOCKED_KINDS = new Set(["caption", "censor", "cutaway"]);
const movableCards = (cues, hookEnd) =>
  cues.filter((cue) => !LOCKED_KINDS.has(cue.kind) && cue.start >= hookEnd - 1e-6).map(({ kind, start }) => ({ kind, start }));

// The insert sfx.py picked (vN.sfx.json's intro), or null until it has run.
function insertOf(video) {
  const events = path.join(WORK, "edl", `${video}.sfx.json`);
  const intro = fs.existsSync(events) ? JSON.parse(fs.readFileSync(events, "utf8")).intro : undefined;
  return Number.isInteger(intro?.at) ? intro : null;
}

// The cues around the insert: the cards sfx.py deferred start there, keeping their length, and the Z-split goes on top.
function aroundInsert(cues, { at, deferred = [] }, rate) {
  const waits = (cue) => deferred.some(({ kind, start }) => kind === cue.kind && Math.abs(start - cue.start) < 1e-6);
  const moved = cues.map((cue) => (waits(cue) ? { ...cue, start: at / rate, stop: cue.stop + at / rate - cue.start } : cue));
  return [...moved, splitClip(rate, "portrait", at)];
}

// The pre-roll's clip at `rate` frames a second, in the orientation's layout.
function prerollAt(rate, layout = "portrait") {
  const frames = introFrames(rate);
  return { frames, clip: { kind: "brandIntro", layout, start: 0, stop: frames / rate, seed: 0 } };
}
const introEvents = (intro) => sfxEvents([intro.clip], brandIntro.sfx);

// One clip alone on its own page, `frames` long at the frame rate in `fps` (an EDL, or just its fps_num and fps_den).
const clipPage = (fps, frames, clip, component, compositionId, size) =>
  composeDocument({ edl: { ...fps, frames, segments: [] }, cues: [clip], registry: { [clip.kind]: component }, compositionId, css: CSS, size }).html;

function writeComposition(dir, html, images = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, "media"), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  for (const [relative, source] of Object.entries({ ...ASSETS, ...images })) {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.copyFileSync(source, path.join(dir, relative));
  }
}

// The intro on its own at `fps` ({ fps_num, fps_den }), for a video without a hook (brand_intro.py): the pre-roll and the
// split as two compositions in the orientation's layout, written under `dir`.
function brandIntroCompositions(orientation, fps, dir) {
  if (!Object.hasOwn(LAYOUTS, orientation)) throw new Error(`the orientation is ${Object.keys(LAYOUTS).join(" or ")}, not ${orientation}`);
  const rate = fps.fps_num / fps.fps_den;
  const intro = prerollAt(rate, orientation);
  const split = splitClip(rate, orientation);
  const write = (name, frames, clip, component) => {
    writeComposition(path.join(dir, name), clipPage(fps, frames, clip, component, `zkidz-brand-${name}`, LAYOUTS[orientation].size));
    return { dir: path.join(dir, name), frames };
  };
  return {
    preroll: write("preroll", intro.frames, intro.clip, brandIntro),
    split: write("split", splitFrames(rate), split, brandSplit),
    events: introEvents(intro),
  };
}

// The clips one layer draws: a behind cue only in the behind pass, captions always in front.
const inLayer = (cue, layer) => (cue.depth === "behind" && cue.kind !== "caption") === (layer === "behind");

// Each cue image copied into the composition (Chrome loads it from there): the cues with page-relative srcs, and the copies.
function withImages(clips) {
  const images = {};
  const resolved = clips.map((cue, index) => {
    if (!REGISTRY[cue.kind]?.image) return cue;
    if (typeof cue.src !== "string" || !cue.src) throw new Error(`${cue.kind} at ${cue.at}: src is required (a repo-relative image path)`);
    const file = path.resolve(REPO, cue.src);
    if (!fs.existsSync(file)) throw new Error(`${cue.kind} at ${cue.at}: no image at ${cue.src} (${file})`);
    // The name lands in an src attribute: anything past [\w.-] could close it.
    const relative = `media/${index}-${path.basename(file).replace(/[^\w.-]/g, "_")}`;
    images[relative] = file;
    return { ...cue, src: relative };
  });
  return { clips: resolved, images };
}

// Writes the composition and returns what the renderer needs; warns like the canvas page, throws on an unknown kind.
function build(target, { guides = false, events = false, variant = "", layer = "front", theme: themeId = DEFAULT_THEME } = {}) {
  if (!LAYERS.includes(layer)) throw new Error(`--layer is behind (or omitted for the normal pass), not ${layer}`);
  const [video, cueList = video] = target.split(":");
  const cueNames = cueList.split(/[+ ,]/).filter(Boolean);
  const edl = JSON.parse(fs.readFileSync(path.join(WORK, "edl", `${video}.json`), "utf8"));
  const theme = loadTheme(themeId);
  canvasBrand().applyTheme(theme);
  const warnings = [];
  const cues = createTimemap(edl, warnings).mapCues(loadCueSheet(WORK, cueNames), {
    // Cover sheets reuse a video's EDL for timing but must not inherit its cutaways and censor gags.
    includeDerived: cueNames.includes(video),
    isKnownKind,
    cutawayTail: canvasBrand().scope.cutawayWipeOut,
  });
  warnings.forEach((warning) => console.warn(`CUE WARNING: ${warning}`));
  const unknown = [...new Set(cues.map((cue) => cue.kind).filter((kind) => !isKnownKind(kind)))];
  if (unknown.length) {
    throw new Error(`unknown cue kinds: ${unknown.join(", ")}. Supported: ${Object.keys(REGISTRY).sort().join(", ")}`);
  }
  // Derived kinds (censor, cutaway) count too: a theme must draw everything the edit puts on screen.
  const undrawn = [...new Set(cues.map((cue) => cue.kind).filter((kind) => !Object.hasOwn(theme.components, kind)))];
  if (undrawn.length) throw new Error(`theme ${theme.id} does not draw ${undrawn.join(", ")}; its kinds: ${Object.keys(theme.components).join(", ")}`);

  const folder = target.replace(/:/g, "--");
  const behind = layer === "behind";
  const dir = path.join(WORK, "hf", [folder, variant, behind && "behind"].filter(Boolean).join("."));
  const compositionId = `zkidz-${folder.replace(/[^A-Za-z0-9-]/g, "-")}`;
  const intro = theme.intro ? introOf(cues, edl) : null;
  const insert = intro ? insertOf(video) : null;
  // Deferred cards move to the insert in both layers; the Z-split goes over the front one only.
  const moved = insert ? aroundInsert(cues, insert, edl.fps_num / edl.fps_den) : cues;
  const { clips, images } = withImages(moved.filter((cue) => (cue.kind === "brandSplit" ? !behind : inLayer(cue, layer))));
  const registry = insert ? { ...REGISTRY, brandSplit } : REGISTRY;
  const { html, placed } = composeDocument({ edl, cues: clips, registry, compositionId: behind ? `${compositionId}-behind` : compositionId, css: CSS, guides });
  writeComposition(dir, html, images);
  fs.writeFileSync(path.join(dir, "cues.json"), JSON.stringify(placed, null, 1));

  // The pre-roll is its own composition, written beside the frame render's (stills never need one).
  let preroll = null;
  if (!variant && !behind) {
    const introDir = path.join(WORK, "hf", `${folder}.intro`);
    fs.rmSync(introDir, { recursive: true, force: true });
    if (intro) writeComposition(introDir, clipPage(edl, intro.frames, intro.clip, brandIntro, `${compositionId}-intro`));
    preroll = intro && { dir: introDir, frames: intro.frames };
  }
  if (events) {
    // A kind's sounds are the canvas page's (SFX_OF), or its own twin's, through the effects' sound design.
    const soundsOf = (cue, duration) => redesign((REGISTRY[cue.kind].sfx ?? canvasBrand().scope.SFX_OF[cue.kind])?.(cue, duration) ?? [], duration);
    const payload = { frames: edl.frames, events: sfxEvents(cues, soundsOf) };
    if (intro) {
      const rate = edl.fps_num / edl.fps_den;
      payload.intro = {
        frames: intro.frames,
        events: introEvents(intro),
        hookEnd: intro.hookEnd,
        splitEvents: sfxEvents([splitClip(rate, "portrait")], brandSplit.sfx),
        cards: movableCards(cues, intro.hookEnd),
      };
    }
    fs.writeFileSync(path.join(WORK, "edl", `${video}.sfx.json`), JSON.stringify(payload, null, 1));
  }
  return { video, cueNames, edl, dir, placed, intro: preroll };
}

if (require.main === module) {
  const [target, ...args] = process.argv.slice(2);
  try {
    const valueOf = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
    const options = {
      guides: args.includes("--guides"),
      events: args.includes("--events"),
      layer: valueOf("--layer", "front"),
      theme: valueOf("--theme", DEFAULT_THEME),
    };
    const { dir, placed } = build(target, options);
    console.log(`${target}: ${placed.length} clips → ${path.join(dir, "index.html")}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { build, brandIntroCompositions };
