// Created by The Angelo Umali.
// Builds the brand HyperFrames composition for one edit: loads the JSON cue files in order (cues.js), maps them through
// the EDL with the canvas page's timemap, and writes <WORK>/hf/<target>/ (index.html, cues.json, assets) in a theme pack's look.
// Usage (work dir as cwd, or ZKS_WORK): node <engine>/hf/build.js v4r:v4+v4r+v4-cc [--events] [--guides] [--layer behind] [--theme id | --style file]
//   --events → also edl/<video>.sfx.json for sfx.py (same schema as render-overlays.js --events), from every cue in both layers
//   --layer behind → hf/<target>.behind/: only the cues with depth "behind" (never captions), drawn under the person matte;
//   the normal build skips them
//   --theme id → themes/<id>/ (default zkidz): palette, type, boil, intro, and the kinds it draws
//   --style file → a project style (work/style.json): its theme with the colours and faces it sets
//   --clips → only edl/<video>.clips.json: each footage cue's card clip (source frame runs, grade) for cardclip.py
// A hookTitle or paperScene with `intro: true` also gets the brand pre-roll (when the theme has an intro): hf/<target>.intro/,
// and an `intro` block in the sfx file that sfx.py and render_final.py read.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createTimemap, sfxEvents } = require("./overlay/timemap");
const { loadCueSheet } = require("./cues");
const { loadTheme, themeFrom, DEFAULT_THEME } = require("./theme");
const { composeDocument } = require("./compose");
const { REGISTRY } = require("./components");
const { canvasBrand } = require("./brand/canvas");
const { fontAssets, fontFaceCss } = require("./brand/fonts");
const { redesign } = require("./fx/sound");
const { INTRO, LAYOUTS, introFrames, brandIntro, brandSplit } = require("./components/intro");
const { frameAtOrAfter } = require("./components/learning/footage-parts");
const { COVER_KINDS, coverSpan } = require("./learning/cover");

const WORK = process.env.ZKS_WORK || process.cwd();
// Cue images (a backdrop, a cutout) are project-relative like a cut spec's inserts.
const REPO = path.dirname(WORK);
// "captions": the words captions alone (render.js drawCaptions); "above": the front cards placed after one of them.
const LAYERS = ["front", "behind", "captions", "above"];
const vendor = (file) => require.resolve(`gsap/dist/${file}`, { paths: [__dirname] });
const ASSETS = {
  ...fontAssets(),
  "brand/zkidz-dev-logo.png": path.join(__dirname, "brand", "zkidz-dev-logo.png"),
  "vendor/gsap.min.js": vendor("gsap.min.js"),
  "vendor/CustomEase.min.js": vendor("CustomEase.min.js"),
};
const CSS = `${fontFaceCss()}
${fs.readFileSync(path.join(__dirname, "brand", "brand.css"), "utf8")}`;
// Read per page: the applied theme sets the colours brand.css takes from custom properties.
const pageCss = () => `${CSS}
:root { --glow: ${canvasBrand().scope.BRAND.goldBright}; }`;
const isKnownKind = (kind) => Object.hasOwn(REGISTRY, kind);

// The edit's brand pre-roll, from its one hookTitle or paperScene (the learning look's paper hook) with `intro: true`. It
// goes in when that hook ends, or after a vlog-style cold open where the hook's `introAt` pin says it ends (never before the
// hook has gone): sfx.py puts the insert at the first pause after that and writes it to vN.sfx.json (intro.at).
const INTRO_HOSTS = new Set(["hookTitle", "paperScene"]);
function introOf(cues, edl) {
  const hooks = cues.filter((cue) => INTRO_HOSTS.has(cue.kind) && cue.intro);
  if (!hooks.length) return null;
  if (hooks.length > 1) throw new Error(`${hooks.map((hook) => hook.kind).join(", ")} have intro: true; an edit has one brand intro`);
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
  cues.filter((cue) => !LOCKED_KINDS.has(cue.kind) && !REGISTRY[cue.kind]?.video && cue.start >= hookEnd - 1e-6).map(({ kind, start }) => ({ kind, start }));

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
  composeDocument({ edl: { ...fps, frames, segments: [] }, cues: [clip], registry: { [clip.kind]: component }, compositionId, css: pageCss(), size }).html;

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

// A words state split at each cover edge it crosses: its colour comes from its start (onCover), so one straddling an edge
// drew ink on footage or white on paper. The pieces join, so a continuing line cross-fades through the join fade.
function splitAtCovers(cues) {
  const edges = cues.filter((cue) => COVER_KINDS.includes(cue.kind)).flatMap((cover) => [cover.start, cover.start + coverSpan(cover)]);
  return cues.flatMap((cue) => {
    if (!REGISTRY[cue.kind]?.splitsAtCovers?.(cue)) return [cue];
    const cuts = [...new Set(edges.filter((edge) => edge > cue.start && edge < cue.stop))].sort((first, second) => first - second);
    const bounds = [cue.start, ...cuts, cue.stop];
    return cuts.length === 0
      ? [cue]
      : bounds.slice(0, -1).map((start, index) => ({
          ...cue,
          start,
          stop: bounds[index + 1],
          joinsBefore: index > 0 || cue.joinsBefore,
          joinsAfter: index < cuts.length || cue.joinsAfter,
          // A name plate meeting any part of the state lifts every piece, so the line never jumps mid-state.
          dodge: cue.dodge ?? [cue.start, cue.stop],
        }));
  });
}

// The clips one layer draws: a behind cue only in the behind pass. Words captions have their own layer (caption_layer.py
// lays it over the cards) except on stills; house captions always draw in front.
const isWordsCaption = (cue) => cue.kind === "caption" && cue.style === "words";
function inLayer(cue, layer, variant) {
  if (variant === "boxes") return layer === "front"; // render.js --boxes measures every cue's text in one page (#43)
  if (isWordsCaption(cue)) return layer === "captions" || (layer === "front" && variant === "stills");
  if (cue.kind === "caption") return layer === "front";
  return layer !== "captions" && (cue.depth === "behind") === (layer === "behind");
}

// specs/paths.inside_project's twin: the realpath must sit under the project's media/ or work dir, or be a file registered
// in place (ZKS_INPLACE). Resolving first defeats `..` and symlinks; Windows paths compare case-folded.
const fold = (file) => (process.platform === "win32" ? file.toLowerCase() : file);
const realpaths = (files) => files.filter((file) => fs.existsSync(file)).map((file) => fold(fs.realpathSync(file)));
function projectImage(src) {
  const real = fs.realpathSync(path.resolve(REPO, src));
  const roots = realpaths([path.join(REPO, "media"), WORK]).map((root) => root + path.sep);
  const registered = realpaths((process.env.ZKS_INPLACE || "").split(path.delimiter).filter(Boolean));
  if (!roots.some((root) => fold(real).startsWith(root)) && !registered.includes(fold(real))) {
    throw new Error(`${src} is outside the project (its media and work folders) and is not a registered in-place file`);
  }
  return real;
}

// Each cue image copied into the composition (Chrome loads it from there): the cues with page-relative srcs, and the copies.
function withImages(clips) {
  const images = {};
  const resolved = clips.map((cue, index) => {
    if (!REGISTRY[cue.kind]?.image) return cue;
    if (typeof cue.src !== "string" || !cue.src) throw new Error(`${cue.kind} at ${cue.at}: src is required (a project-relative image path)`);
    if (!fs.existsSync(path.resolve(REPO, cue.src))) throw new Error(`${cue.kind} at ${cue.at}: no image at ${cue.src}`);
    const file = projectImage(cue.src);
    // The name lands in an src attribute: anything past [\w.-] could close it.
    const relative = `media/${index}-${path.basename(file).replace(/[^\w.-]/g, "_")}`;
    images[relative] = file;
    return { ...cue, src: relative };
  });
  return { clips: resolved, images };
}

// The source frame runs a cue's edited window shows, following the EDL across cuts (punched runs flagged).
function editRuns(cue, edl) {
  const fps = edl.fps_num / edl.fps_den;
  const [first, end] = [frameAtOrAfter(cue.start, fps), frameAtOrAfter(cue.stop, fps)];
  const runs = [];
  for (const segment of [...edl.segments].sort((a, b) => a.target - b.target)) {
    const [from, to] = [Math.max(first, segment.target), Math.min(end, segment.target + segment.out - segment.in)];
    if (to > from) runs.push([segment.in + from - segment.target, segment.in + to - segment.target, segment.zoom > 1]);
  }
  return { first, end, runs };
}

// The source frames a card plays: its own window's edit runs, or one unbroken run from `sourceSecond` as long as the
// window. Only edit runs must clear the master's animated zooms, which they mirror.
function sourceRuns(cue, edl) {
  const { first, end, runs } = editRuns(cue, edl);
  const covered = runs.reduce((sum, [from, to]) => sum + to - from, 0);
  if (covered !== end - first) throw new Error(`${cue.kind} at ${cue.at}s: the EDL covers ${covered} of its ${end - first} frames`);
  if (cue.sourceSecond === undefined) {
    const zoom = (edl.zooms ?? []).find((item) => item.start < end && item.end > first);
    if (zoom)
      throw new Error(`${cue.kind} at ${cue.at}s overlaps an animated zoom (${zoom.preset}, frames ${zoom.start}–${zoom.end}); card clips can't follow it`);
    return { first, frames: end - first, ranges: runs };
  }
  if (!(cue.sourceSecond >= 0)) throw new Error(`${cue.kind} at ${cue.at}s: sourceSecond is source seconds, not ${cue.sourceSecond}`);
  const from = Math.round((cue.sourceSecond * edl.fps_num) / edl.fps_den);
  return { first, frames: end - first, ranges: [[from, from + end - first, false]] };
}

// `crop` [x, y, w, h] on the 1080 grid frames one part of the source.
function checkCrop(cue) {
  if (!cue.crop) return;
  const [x, y, w, h] = cue.crop;
  if (!(w % 2 === 0 && h % 2 === 0 && x >= 0 && y >= 0 && x + w <= 1080 && y + h <= 1920))
    throw new Error(`${cue.kind} at ${cue.at}s: crop ${JSON.stringify(cue.crop)} is not an even-sized box inside the 1080x1920 frame`);
}

// A footage cue's card clip, named by a hash of what it shows so a changed cue never plays a stale clip.
function clipPlan(cue, edl, video) {
  const grade = REGISTRY[cue.kind].clipGrade?.(cue) ?? cue.grade ?? "edit";
  if (!["edit", "raw"].includes(grade)) throw new Error(`${cue.kind} at ${cue.at}s: grade is edit or raw, not ${grade}`);
  const { first, frames, ranges } = sourceRuns(cue, edl);
  checkCrop(cue);
  const base = edl.base ?? video;
  const look = grade === "raw" ? "raw" : (edl.grade ?? "house");
  const id = `${cue.kind}-${crypto
    .createHash("sha256")
    .update(JSON.stringify({ base, ranges, look, punch: edl.punch_crop, ...(cue.crop ? { crop: cue.crop } : {}) }))
    .digest("hex")
    .slice(0, 10)}`;
  return {
    id,
    kind: cue.kind,
    at: cue.at,
    start: cue.start,
    stop: cue.stop,
    firstFrame: first,
    frames,
    grade,
    ranges,
    crop: cue.crop,
    file: `cardclips/${video}-${id}.mp4`,
  };
}

// Each footage cue's clip copied into the composition when cardclip.py has encoded it; render.js refuses the missing ones.
function withClips(clips, edl, video) {
  const files = {};
  const missing = [];
  const resolved = clips.map((cue) => {
    if (!REGISTRY[cue.kind]?.video) return cue;
    const plan = clipPlan(cue, edl, video);
    const source = path.join(WORK, plan.file);
    if (fs.existsSync(source)) files[`media/clip-${plan.id}.mp4`] = source;
    else missing.push(plan);
    return { ...cue, src: `media/clip-${plan.id}.mp4`, ranges: plan.ranges };
  });
  return { clips: resolved, files, missing };
}

// grow.at / shrink.at are source seconds after cue.at like any pin; the kind reads them on the edit, across its cuts.
function movesOnEdit(cue, edl) {
  const fps = edl.fps_num / edl.fps_den;
  const { first, end, runs } = editRuns(cue, edl);
  const onEdit = (move) => {
    if (typeof move?.at !== "number") return move;
    const frame = (cue.at + move.at) * fps;
    let edited = end;
    let offset = first;
    for (const [from, to] of runs) {
      if (frame < to) {
        edited = offset + Math.max(0, frame - from);
        break;
      }
      offset += to - from;
    }
    return { ...move, at: edited / fps - cue.start };
  };
  return Object.fromEntries(["grow", "shrink"].filter((key) => cue[key]).map((key) => [key, onEdit(cue[key])]));
}

// The target's EDL and its cue sheet mapped onto the edit in `theme`'s look; throws on a kind it does not draw.
function loadEdit(target, themeId) {
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
  // Footage moves mapped once, so the render and the --events sounds read the same edited pins.
  const placed = cues.map((cue) => (REGISTRY[cue.kind].video ? { ...cue, ...movesOnEdit(cue, edl) } : cue));
  return { video, cueNames, edl, theme, cues: placed };
}

// edl/<video>.clips.json: every footage cue's clip, for cardclip.py (no composition is written).
function writeClipManifest(target, themeId = DEFAULT_THEME) {
  const { video, edl, cues } = loadEdit(target, themeId);
  const plans = cues.filter((cue) => REGISTRY[cue.kind].video).map((cue) => clipPlan(cue, edl, video));
  const clips = [...new Map(plans.map((plan) => [plan.id, plan])).values()];
  const file = path.join(WORK, "edl", `${video}.clips.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ video, base: edl.base ?? video, fps_num: edl.fps_num, fps_den: edl.fps_den, clips }, null, 1));
  return { file, clips };
}

// Writes the composition and returns what the renderer needs; warns like the canvas page, throws on an unknown kind.
// `window` [first, end) composes only those edited frames, clips shifted to start at its first frame (span renders).
// `plates` holds every caption at rest (no rise, no fade): the caption pass snapshots each one once.
// `after` (the "above" layer): draw only the front cards placed after this page index, i.e. over that caption.
function build(
  target,
  {
    guides = false,
    events = false,
    settled = false,
    variant = "",
    layer = "front",
    theme: themeId = DEFAULT_THEME,
    window = null,
    plates = false,
    after = -1,
  } = {},
) {
  if (!LAYERS.includes(layer)) throw new Error(`--layer is ${LAYERS.slice(1).join(", ")} (or omitted for the normal pass), not ${layer}`);
  const { video, cueNames, edl, theme, cues } = loadEdit(target, themeId);
  const drawable = splitAtCovers(cues);

  const folder = target.replace(/:/g, "--");
  const behind = layer === "behind";
  const dir = path.join(WORK, "hf", [folder, variant, layer !== "front" && layer, plates && "plates", window && `span${window[0]}`].filter(Boolean).join("."));
  const compositionId = `zkidz-${folder.replace(/[^A-Za-z0-9-]/g, "-")}`;
  const intro = theme.intro ? introOf(cues, edl) : null;
  const insert = intro ? insertOf(video) : null;
  const rate = edl.fps_num / edl.fps_den;
  // Deferred cards move to the insert in every layer; the Z-split goes over the front one only.
  const moved = insert ? aroundInsert(drawable, insert, rate) : drawable;
  // In one page a later clip draws on top, so a front card covers the captions placed before it: the "above" pass draws
  // the cards after one caption alone.
  const front = (cue) => cue.kind === "brandSplit" || inLayer(cue, "front", variant);
  const kept =
    layer === "above"
      ? moved.filter((cue, index) => index > after && front(cue))
      : moved.filter((cue) => (cue.kind === "brandSplit" ? layer === "front" : inLayer(cue, layer, variant)));
  const withImageFiles = withImages(kept);
  const { clips, files, missing } = withClips(withImageFiles.clips, edl, video);
  const images = { ...withImageFiles.images, ...files };
  const drawnClips = plates ? clips.map((cue) => ({ ...cue, joinsBefore: true, joinsAfter: true, atRest: true })) : clips;
  const registry = insert ? { ...REGISTRY, brandSplit } : REGISTRY;
  const shift = window ? window[0] / rate : 0;
  const { html, placed } = composeDocument({
    edl: window ? { ...edl, frames: window[1] - window[0] } : edl,
    // Only the window's own clips: one before it, shifted to negative times, would be clamped to its first frame and drawn.
    cues: window
      ? drawnClips
          .filter((cue) => cue.stop > shift && cue.start < window[1] / rate)
          .map((cue) => ({ ...cue, start: cue.start - shift, stop: cue.stop - shift }))
      : drawnClips,
    // The whole sheet, whatever this pass draws: a caption still dodges the name plates drawn in another layer.
    contextCues: moved,
    registry,
    compositionId: behind ? `${compositionId}-behind` : compositionId,
    css: pageCss(),
    guides,
    settled,
  });
  writeComposition(dir, html, images);
  fs.writeFileSync(path.join(dir, "cues.json"), JSON.stringify(placed, null, 1));

  // The pre-roll is its own composition, written beside the frame render's (stills never need one).
  let preroll = null;
  if (!variant && layer === "front" && !window) {
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
      payload.intro = {
        frames: intro.frames,
        events: introEvents(intro),
        hookEnd: intro.hookEnd,
        splitFrames: splitFrames(rate), // the edit frames the Z-split covers on purpose (v2_qc.py skips them)
        splitEvents: sfxEvents([splitClip(rate, "portrait")], brandSplit.sfx),
        cards: movableCards(cues, intro.hookEnd),
      };
    }
    fs.writeFileSync(path.join(WORK, "edl", `${video}.sfx.json`), JSON.stringify(payload, null, 1));
  }
  // Each placed clip's page index: its place in the one page, which decides what it covers.
  const pages = placed.map((cue) => moved.indexOf(kept[Number(cue.id.slice(1))]));
  return { video, cueNames, edl, dir, placed, clips, pages, intro: preroll, missingClips: missing };
}

if (require.main === module) {
  const [target, ...args] = process.argv.slice(2);
  try {
    const valueOf = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
    if (args.includes("--clips")) {
      const { file, clips } = writeClipManifest(target, themeFrom(args));
      console.log(`${target}: ${clips.length} card clips → ${file}`);
      process.exit(0);
    }
    const options = {
      guides: args.includes("--guides"),
      events: args.includes("--events"),
      layer: valueOf("--layer", "front"),
      theme: themeFrom(args),
    };
    const { dir, placed } = build(target, options);
    console.log(`${target}: ${placed.length} clips → ${path.join(dir, "index.html")}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { build, brandIntroCompositions, writeClipManifest, splitAtCovers };
