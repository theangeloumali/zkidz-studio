// Created by The Angelo Umali.
// Draws an edit's brand overlay track with HyperFrames into the contract render_final.py reads: frames/<video>/00000.png …,
// one transparent 1080x1920 PNG per edited frame. Argument-compatible with render-overlays.js. From the work dir (or ZKS_WORK):
//   node <engine>/hf/render.js v4r:v4+v4r+v4-cc            → frames/v4r/ (+ frames/v4r.intro/ for an intro hook)
//   … --stills auto | 3.2 41.5 [--guides]                  → stills/<cues>.hf/t3.2.png, composited on the proxy
//   … --stills 3.2 --settled                               → refused while a title is still animating in (covers)
//   … --stills auto --max 4                                → only the earliest 4 auto times are drawn
//   … --events                                             → edl/<video>.sfx.json only (for sfx.py)
//   … --boxes                                              → edl/<video>.text.json: each cue's text boxes (qc/text_gates.py)
//   … --theme minimal                                       → draws in themes/minimal's look (default themes/zkidz)
//   … --style work/style.json                               → draws the style's theme under its colours and faces
//   … --layer behind [--stills …]                          → frames/<video>.behind/ (stills/<cues>.hf.behind/): only the
//                                                            depth "behind" cues, which render_final.py lays under the matte
// A frame render also writes the words-caption layer: frames/<video>.plates/, frames/<video>.cc.json and, where a card
// covers a caption, frames/<video>.above/ (caption_layer.py turns them into frames).
//   node <engine>/hf/render.js --brand-intro landscape --fps 30000/1001 --out DIR   → DIR/preroll/, DIR/split/ (brand_intro.py)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { execFileSync, spawn } = require("child_process");
const { build: buildComposition, brandIntroCompositions } = require("./build");
const { optionValue } = require("./cli-args");
const { themeFrom } = require("./theme");
const { EXIT_SECONDS } = require("./fx/motion");
const { springValue } = require("./fx/springs");
const { RISE: CAPTION_RISE, JOIN_FADE_FRAMES, continuesLine, joinAlpha } = require("./components/captions");
const progress = require("./progress");
const { ffmpegBin, hyperframesToolsEnv } = require("./home");
const { takeSlot } = require("./slots");
const { measureText } = require("./text-boxes");
const { resetDir, compositeStills, frameName, fillBlanks } = require("./stills");

const WORK = process.env.ZKS_WORK || process.cwd();

// A footage cue whose card clip is not encoded yet fails the render, naming the command that encodes it.
function requireClips(built, target) {
  const [missing] = built.missingClips;
  if (!missing) return built;
  const more = built.missingClips.length > 1 ? ` (and ${built.missingClips.length - 1} more)` : "";
  throw new Error(`${missing.kind} at ${missing.at}s: its card clip ${missing.file} is missing${more}; run cardclip.py ${target}`);
}
const build = (target, options) => requireClips(buildComposition(target, options), target);
const HF_PACKAGE = path.join(__dirname, "node_modules", "hyperframes");
const HF_BIN = path.join(HF_PACKAGE, require(path.join(HF_PACKAGE, "package.json")).bin.hyperframes);
// Nothing leaves the machine: no telemetry, no update check or self-install, and snapshots never go to Gemini (--describe false).
const LOCAL_ONLY = { DO_NOT_TRACK: "1", HYPERFRAMES_NO_TELEMETRY: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_AUTO_INSTALL: "1" };
// HyperFrames loads each page within PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS (default 10 s); a loaded machine needs longer.
const PAGE_LOAD = { PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS: "60000" };
const childEnv = () => ({ ...process.env, ...hyperframesToolsEnv(), ...LOCAL_ONLY, ...PAGE_LOAD });
const RENDER_WORKERS = "8"; // measured: 16 workers capture no faster than 8 (docs/hyperframes.md)
const HF_FRAME = /^frame_(\d{6})\.png$/;

// A failed child as text: its stderr, else its stdout, else the error, with how it ended on the last line, which is the
// line the engine reports. An empty stderr Buffer is truthy, so `stderr || message` printed nothing.
function failureText(error) {
  const output = [error.stderr, error.stdout].map((stream) => String(stream ?? "").trim()).find(Boolean) ?? error.message;
  return `${output.slice(-4000)} (${error.signal ? `killed by ${error.signal}` : `exit code ${error.status}`})`;
}

const OUTPUT_TAIL = 64 * 1024; // of each stream, kept for the failure message

// Runs the HyperFrames CLI; `onOutput` sees its output as it arrives (a render's "Capturing frame N/M" lines).
function hyperframes(args, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HF_BIN, ...args], {
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tails = { stdout: "", stderr: "" };
    for (const name of Object.keys(tails))
      child[name].on("data", (chunk) => {
        tails[name] = (tails[name] + chunk).slice(-OUTPUT_TAIL);
        onOutput(String(chunk));
      });
    child.on("error", reject);
    child.on("close", (status, signal) =>
      status === 0 ? resolve() : reject(new Error(`hyperframes ${args[0]} failed:\n${failureText({ ...tails, message: "", status, signal })}`)),
    );
  });
}

// The last "Capturing frame N/M" in some HyperFrames output, or 0.
function framesCaptured(text) {
  const counts = [...text.matchAll(/Capturing frame (\d+)\//g)];
  return counts.length ? Number(counts.at(-1)[1]) : 0;
}

const PNG_RGB = 2; // IHDR colour type
const colourType = (file) => {
  const head = Buffer.alloc(26);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, head, 0, 26, 0);
  fs.closeSync(fd);
  return head[25];
};

// Chrome saves a fully opaque frame (the brand intro, the Z-split's first frames) as RGB. render_final.py needs one
// format through a chunk (a mid-chunk change crashed overlay_cuda), so each run of RGB frames is rewritten as RGBA.
function withAlpha(framesDir) {
  const flat = fs
    .readdirSync(framesDir)
    .filter((file) => file.endsWith(".png") && colourType(path.join(framesDir, file)) === PNG_RGB)
    .map((file) => Number.parseInt(file, 10));
  const runs = [];
  for (const index of flat) {
    if (runs.at(-1)?.at(-1) === index - 1) runs.at(-1).push(index);
    else runs.push([index]);
  }
  const staging = `${framesDir}.alpha`;
  for (const run of runs) {
    resetDir(staging);
    const pattern = (dir) => path.join(dir, "%05d.png");
    execFileSync(ffmpegBin(), [
      "-v",
      "error",
      "-start_number",
      `${run[0]}`,
      "-i",
      pattern(framesDir),
      "-frames:v",
      `${run.length}`,
      "-pix_fmt",
      "rgba",
      "-start_number",
      `${run[0]}`,
      pattern(staging),
    ]);
    for (const file of fs.readdirSync(staging)) fs.renameSync(path.join(staging, file), path.join(framesDir, file));
  }
  fs.rmSync(staging, { recursive: true, force: true });
}

// One composition → framesDir/00000.png …, exactly `count` RGBA PNGs at `fps` ({ fps_num, fps_den }).
async function renderSequence(dir, fps, count, framesDir, onFrames = () => {}) {
  const staging = `${framesDir}.hf`;
  resetDir(staging);
  // Not --quiet: its capture lines are this stage's progress.
  await hyperframes(
    ["render", dir, "--format", "png-sequence", "--fps", `${fps.fps_num}/${fps.fps_den}`, "--workers", RENDER_WORKERS, "-o", staging],
    (text) => {
      const frames = framesCaptured(text);
      if (frames) onFrames(frames);
    },
  );
  const pngs = fs
    .readdirSync(staging)
    .filter((file) => HF_FRAME.test(file))
    .sort();
  // render_final.py asserts the count too, but failing here names the renderer instead of the composite.
  if (pngs.length !== count) throw new Error(`${path.basename(framesDir)}: hyperframes wrote ${pngs.length} frames, expected ${count}`);
  resetDir(framesDir);
  pngs.forEach((file, index) => fs.renameSync(path.join(staging, file), path.join(framesDir, frameName(index))));
  fs.rmSync(staging, { recursive: true, force: true });
  withAlpha(framesDir);
}

async function renderFrames(target, layer, theme, force) {
  const video = target.split(":")[0];
  if (layer === "behind") return progress.track(video, "behind", (stage) => drawBehind(target, stage, theme, force));
  const cards = await progress.track(video, "frames", (stage) => drawFrames(target, stage, theme, force));
  // Under the overlay slot drawFrames took, held until exit (takeSlot is not re-entrant).
  await progress.track(video, "captions", () => drawCaptions(target, theme, force, cards));
}

// The words-caption layer: one settled plate per caption (frames/<v>.plates/), snapshotted once by HyperFrames, and its
// rise and fade per frame (frames/<v>.cc.json), from the same springs the page tweens; caption_layer.py writes the frames.
// `cards`: the front pass's placed clips with their page index. The sheet names the keys of the card, plate and above frames
// it was drawn against; caption_layer.py refuses any other set.
async function drawCaptions(target, theme, force, cards) {
  const { video, edl, dir, placed, clips, pages } = build(target, { layer: "captions", plates: true, theme });
  const platesDir = path.join(WORK, "frames", `${video}.plates`);
  const layerFile = path.join(WORK, "frames", `${video}.cc.json`);
  const aboveDir = path.join(WORK, "frames", `${video}.above`);
  if (!placed.length) {
    for (const stale of [platesDir, layerFile, aboveDir]) fs.rmSync(stale, { recursive: true, force: true });
    return;
  }
  const fps = edl.fps_num / edl.fps_den;
  const times = placed.map((cue) => +(Math.floor((cue.firstFrame + cue.endFrame - 1) / 2) / fps).toFixed(6));
  const started = Date.now();
  const clipOf = (cue) => clips[Number(cue.id.slice(1))];
  // A re-cut moves every caption, so plates are cached per caption, keyed without its timing: only changed ones are shot.
  const page = compositionKey([dir, ...rendererDirs()], { theme }, ["index.html", "cues.json", "snapshots", "test", "node_modules"]);
  const markup = captionMarkup(fs.readFileSync(path.join(dir, "index.html"), "utf8"));
  const plateKeys = placed.map((cue) => plateKey(page, markup[cue.id]));
  const cacheDir = path.join(WORK, "frames", `${video}.platecache`);
  let shot = 0;
  const drawn = await cachedPass(platesDir, compositionKey([dir], { times }), [[platesDir, placed.length]], force, async () => {
    if (force) fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    const missing = [...new Set(platesToDraw(plateKeys, cacheDir).map((index) => plateKeys[index]))].map((key) => plateKeys.indexOf(key));
    if (missing.length) {
      const staging = `${platesDir}.new`;
      resetDir(staging);
      (
        await snapshot(
          dir,
          missing.map((index) => times[index]),
        )
      ).forEach((file, at) => fs.renameSync(file, path.join(staging, plateName(at))));
      withAlpha(staging);
      missing.forEach((index, at) => fs.renameSync(path.join(staging, plateName(at)), path.join(cacheDir, `${plateKeys[index]}.png`)));
      fs.rmSync(staging, { recursive: true, force: true });
    }
    resetDir(platesDir);
    plateKeys.forEach((key, index) => fs.copyFileSync(path.join(cacheDir, `${key}.png`), path.join(platesDir, plateName(index))));
    const used = new Set(plateKeys.map((key) => `${key}.png`));
    for (const file of fs.readdirSync(cacheDir)) if (!used.has(file)) fs.rmSync(path.join(cacheDir, file), { force: true });
    shot = missing.length;
  });
  console.log(drawn ? `${video}: ${shot} of ${placed.length} caption plates drawn in ${seconds(started)} s` : `${video}: caption plates unchanged, skipped`);
  // In one page a card covers the captions placed before it. Each covered caption's frames under such cards get a window of
  // those cards drawn alone (frames/<v>.above/): what caption_layer.py lays that caption under.
  const windows = placed.flatMap((cue, index) => {
    const over = cards.filter((card) => card.page > pages[index] && card.firstFrame < cue.endFrame && card.endFrame > cue.firstFrame);
    if (!over.length) return [];
    const first = Math.max(cue.firstFrame, Math.min(...over.map((card) => card.firstFrame)));
    return [[first, Math.min(cue.endFrame, Math.max(...over.map((card) => card.endFrame))), { after: pages[index] }]];
  });
  if (windows.length) {
    // Each window renders from SPAN_LEAD frames early but keeps only its own: a joined caption's lead-in is the last
    // frames of the caption before it.
    const spans = windows.map(([first, end, options]) => [Math.max(0, first - SPAN_LEAD), end, options, first]);
    const dirs = spans.map(([first, end, options]) => build(target, { layer: "above", window: [first, end], theme, ...options }).dir);
    const count = new Set(windows.flatMap(([first, end]) => Array.from({ length: end - first }, (_, index) => first + index))).size;
    await cachedPass(aboveDir, compositionKey(dirs, { spans }), [[aboveDir, count]], force, async () => {
      resetDir(aboveDir);
      await drawSpans(target, "above", edl, spans, aboveDir, theme);
    });
  } else fs.rmSync(aboveDir, { recursive: true, force: true });
  const captions = placed.map((cue, index) => {
    const next = placed[index + 1];
    const hold = next ? joinHold(cue, next, clipOf(next)) : 0;
    return { plate: plateName(index), first: cue.firstFrame, end: cue.endFrame, ...(hold ? { hold } : {}), motion: captionMotion(clipOf(cue), cue, fps) };
  });
  const under = windows.map(([first, end]) => [first, end]);
  const keys = { cards: readKey(path.join(WORK, "frames", video)), plates: readKey(platesDir), above: readKey(aboveDir) };
  fs.writeFileSync(layerFile, JSON.stringify({ frames: edl.frames, ...keys, captions, under }));
}

// HyperFrames snapshots of `dir` at `times`, in that order (it names them frame-<index>-at-<time>.png, index in --at order).
async function snapshot(dir, times) {
  const snapshots = path.join(dir, "snapshots");
  resetDir(snapshots);
  await hyperframes(["snapshot", dir, "--at", times.join(","), "--describe", "false", "--no-end"]);
  const shots = fs
    .readdirSync(snapshots)
    .map((name) => [Number(/^frame-(\d+)-at-/.exec(name)?.[1]), path.join(snapshots, name)])
    .filter(([index]) => Number.isInteger(index))
    .sort((first, second) => first[0] - second[0]);
  if (shots.length !== times.length) throw new Error(`snapshot wrote ${shots.length} frames for ${times.length} times`);
  return shots.map(([, shot]) => shot);
}

const seconds = (started) => ((Date.now() - started) / 1000).toFixed(0);

const plateName = (index) => `${String(index).padStart(4, "0")}.png`;

// A caption's plate key: the renderer's code, assets and theme (`page`) and the caption's drawn markup. The markup, not
// the cue, because its ink over paper and its line layout come from other cues; its timing sits on the wrapper only.
const plateKey = (page, markup) =>
  crypto
    .createHash("sha256")
    .update(page)
    .update(markup ?? "")
    .digest("hex");

// {clip id: the markup inside its wrapper} from a built page, one clip per line as compose.js writes them. Element ids
// carry the cue's seed (its index in the sheet), so they are numbered out: a cue added earlier renames them, nothing else.
const captionMarkup = (html) =>
  Object.fromEntries([...html.matchAll(/^\s*<div id="(c\d+)" class="clip"[^>]*>(.*)$/gm)].map(([, id, markup]) => [id, markup.replace(/\bs\d+-/g, "s-")]));

// The renderer's own code: index.html carries every cue's timing, so the plate key reads the sources it is built from.
const rendererDirs = () => [__dirname];

// Indices of `keys` with no cached plate in `cacheDir`.
const platesToDraw = (keys, cacheDir) => keys.flatMap((key, index) => (fs.existsSync(path.join(cacheDir, `${key}.png`)) ? [] : [index]));

// Frames a caption stays drawn past its end, under the words state that continues its line, until that one is full.
const joinHold = (placed, next, nextCue) =>
  continuesLine(nextCue) && next.firstFrame === placed.endFrame ? Math.min(JOIN_FADE_FRAMES, next.endFrame - next.firstFrame) : 0;

// [frame, alpha, dy] for each frame the caption is not at rest: the page's rise (y and opacity on the standard spring,
// from the cue's snapped start) and fade (opacity over EXIT_SECONDS, power2.in, ending at its stop); joins skip either.
// A words state continuing its line fades in over JOIN_FADE_FRAMES instead. dy is floored: Chrome draws the moving text on
// whole pixels, rounded down, and the text is what has to match.
function captionMotion(cue, placed, fps) {
  const snap = (time) => Math.round(time * fps) / fps;
  const riseAt = snap(cue.start);
  const fadeAt = snap(cue.stop - EXIT_SECONDS);
  const motion = [];
  for (let frame = placed.firstFrame; frame < placed.endFrame; frame++) {
    const time = frame / fps;
    let [alpha, dy] = [1, 0];
    const fading = frame - placed.firstFrame;
    if (continuesLine(cue)) alpha = fading < JOIN_FADE_FRAMES ? joinAlpha(fading) : 1;
    else if (!cue.joinsBefore) {
      const local = time - riseAt;
      alpha = local < 0 ? 0 : springValue("standard", "alpha", local);
      dy = Math.floor(local < 0 ? CAPTION_RISE : CAPTION_RISE * (1 - springValue("standard", "travel", local)));
    }
    // GSAP's power2 is cubic.
    if (!cue.joinsAfter && time >= fadeAt) alpha = 1 - Math.min((time - fadeAt) / EXIT_SECONDS, 1) ** 3;
    if (alpha < 0.9995 || dy) motion.push([frame, +alpha.toFixed(5), dy]);
  }
  return motion;
}

// The overlay cache: a pass is skipped when its compositions' files, frame counts and rate match its last finished draw.
function compositionKey(dirs, facts, skip = []) {
  const hash = crypto.createHash("sha256").update(JSON.stringify(facts));
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir, { recursive: true }).map(String).sort()) {
      if (skip.some((name) => file === name || file.startsWith(`${name}${path.sep}`))) continue;
      const full = path.join(dir, file);
      if (fs.statSync(full).isFile()) hash.update(file).update(fs.readFileSync(full));
    }
  }
  return hash.digest("hex");
}

const pngCount = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith(".png")).length : -1);
// Kept inside the folder, so whatever resets it (the canvas renderer too) drops the key with the frames.
const keyFile = (framesDir) => path.join(framesDir, ".hash");
const readKey = (framesDir) => (fs.existsSync(keyFile(framesDir)) ? fs.readFileSync(keyFile(framesDir), "utf8") : null);

// Runs `draw` unless `framesDir` holds `key` and every [dir, count] in `counts` has its PNGs; true when it drew.
async function cachedPass(framesDir, key, counts, force, draw) {
  if (!force && readKey(framesDir) === key && counts.every(([dir, frames]) => pngCount(dir) === frames)) return false;
  fs.rmSync(keyFile(framesDir), { force: true });
  await draw();
  fs.writeFileSync(keyFile(framesDir), key);
  return true;
}

// The behind layer: frames/<video>.behind/, on the same frame grid as frames/<video>/. A sheet with no behind cue leaves no
// folder, so a stale one from an earlier sheet never reaches the composite.
async function drawBehind(target, stage, theme, force) {
  await takeSlot("overlay", `hf/render.js ${target} --layer behind (${WORK})`, stage.wait);
  const { video, edl, dir, placed } = build(target, { layer: "behind", theme });
  const framesDir = path.join(WORK, "frames", `${video}.behind`);
  if (!placed.length) {
    fs.rmSync(framesDir, { recursive: true, force: true });
    return console.log(`${video}: no depth "behind" cue, so no behind layer`);
  }
  // Only the cues' frames are drawn: a short frame escape must not cost a whole edit of blank frames.
  const spans = spansOf(placed);
  const key = compositionKey([dir], { frames: edl.frames, fps: [edl.fps_num, edl.fps_den], spans });
  const drawn = spans.reduce((total, [first, end]) => total + end - first, 0);
  const started = Date.now();
  const redrawn = await cachedPass(framesDir, key, [[framesDir, edl.frames]], force, async () => {
    stage.begin(drawn, drawn);
    resetDir(framesDir);
    const blank = `${framesDir}.blank.png`;
    fs.writeFileSync(blank, transparentPng(1080, 1920));
    await drawSpans(target, "behind", edl, spans, framesDir, theme, stage.update);
    fillBlanks(framesDir, edl.frames, blank);
    fs.rmSync(blank, { force: true });
  });
  if (!redrawn) return console.log(`${video}: behind layer unchanged, skipped`);
  console.log(`${video}: ${drawn} of ${edl.frames} behind-layer frames drawn (${placed.length} cues, ${spans.length} spans) in ${seconds(started)} s`);
}

const SPAN_MERGE_GAP = 90; // frames: a gap shorter than this costs less to draw than a second HyperFrames start-up
const SPAN_LEAD = 3;

// The frames cues cover, merged into spans. A span opens SPAN_LEAD frames early: shifted to a negative start, a clip lost
// compose.js's quarter-frame lead and drew a frame late.
const spansOf = (cues) => mergeSpans(cues.map((cue) => [Math.max(0, cue.firstFrame - SPAN_LEAD), cue.endFrame]));

// Each [first, end, build options?, keep?] span of `layer` drawn on its own page, its frames from `keep` (default: all)
// moved into framesDir at their edited-frame numbers.
async function drawSpans(target, layer, edl, spans, framesDir, theme, onFrames = () => {}) {
  let done = 0;
  for (const [first, end, options = {}, keep = first] of spans) {
    const spanFrames = `${framesDir}.span`;
    const { dir } = build(target, { layer, window: [first, end], theme, ...options });
    await renderSequence(dir, edl, end - first, spanFrames, (frames) => onFrames(done + frames));
    fs.readdirSync(spanFrames)
      .sort()
      .forEach((file, index) => first + index >= keep && fs.renameSync(path.join(spanFrames, file), path.join(framesDir, frameName(first + index))));
    fs.rmSync(spanFrames, { recursive: true, force: true });
    done += end - first;
  }
}

function mergeSpans(ranges) {
  const spans = [];
  for (const [first, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (spans.length && first - spans.at(-1)[1] < SPAN_MERGE_GAP) spans.at(-1)[1] = Math.max(spans.at(-1)[1], end);
    else spans.push([first, end]);
  }
  return spans;
}

// A fully transparent 8-bit RGBA PNG. ffmpeg's lavfi `color` source negotiates away the alpha and wrote opaque black.
function transparentPng(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, adaptive filter, no interlace
  const rows = Buffer.alloc((width * 4 + 1) * height); // every row: filter byte 0, then transparent pixels
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

async function drawFrames(target, stage, theme, force) {
  await takeSlot("overlay", `hf/render.js ${target} (${WORK})`, stage.wait);
  const { video, edl, dir, intro, placed, pages } = build(target, { theme });
  const framesDir = path.join(WORK, "frames", video);
  const introDir = path.join(WORK, "frames", `${video}.intro`);
  // The insert these frames carry the Z-split at: render_final checks it against sfx.py's.
  const split = placed.find((cue) => cue.kind === "brandSplit");
  const insertFile = path.join(WORK, "frames", `${video}.insert.json`);
  fs.mkdirSync(path.dirname(insertFile), { recursive: true });
  if (split) fs.writeFileSync(insertFile, JSON.stringify({ at: split.firstFrame }));
  else fs.rmSync(insertFile, { force: true });
  const key = compositionKey([dir, intro?.dir].filter(Boolean), { frames: edl.frames, intro: intro?.frames ?? 0, fps: [edl.fps_num, edl.fps_den] });
  const counts = [[framesDir, edl.frames], ...(intro ? [[introDir, intro.frames]] : [])];
  const started = Date.now();
  const redrawn = await cachedPass(framesDir, key, counts, force, async () => {
    stage.begin(edl.frames + (intro?.frames ?? 0), edl.frames);
    await renderSequence(dir, edl, edl.frames, framesDir, stage.update);
    // The brand pre-roll render_final.py splices in; a stale one from an earlier sheet must not survive.
    if (intro) await renderSequence(intro.dir, edl, intro.frames, introDir, (frames) => stage.update(edl.frames + frames));
    else fs.rmSync(introDir, { recursive: true, force: true });
  });
  const drawn = edl.frames + (intro?.frames ?? 0);
  const took = (Date.now() - started) / 1000;
  console.log(
    redrawn
      ? `${video}: ${drawn} frames drawn by HyperFrames in ${took.toFixed(0)} s (${(drawn / took).toFixed(1)} fps)${intro ? `, ${intro.frames} of them the brand intro` : ""}`
      : `${video}: overlays unchanged, skipped`,
  );
  return placed.map((cue, index) => ({ ...cue, page: pages[index] }));
}

// "auto" = one still per non-caption cue just before its exit, when every item has landed (captions show on every still).
const SETTLED_BEFORE_EXIT = EXIT_SECONDS + 0.1;
const autoTimes = (placed) =>
  placed.filter((cue) => cue.kind !== "caption").map((cue) => +Math.max(cue.start + (cue.stop - cue.start) / 2, cue.stop - SETTLED_BEFORE_EXIT).toFixed(2));

// Each still that catches a cue before it has landed, with the first time that works instead.
const unsettledStills = (placed, times) =>
  times.flatMap((time) =>
    placed
      .filter((cue) => cue.landed !== undefined && cue.start <= time && time < cue.landed)
      .map(
        (cue) =>
          `${time} s catches the ${cue.kind} before it lands at ${cue.landed.toFixed(2)} s: take it at ${(Math.ceil(cue.landed * 10) / 10).toFixed(1)} s or later`,
      ),
  );

// The still times to draw: the ones named, or (auto) each cue's settled moment, the earliest `max` of them.
function stillTimesFor(placed, times, max = Infinity) {
  if (times[0] !== "auto") return [...new Set(times.map(Number))];
  return [...new Set(autoTimes(placed))].sort((first, second) => first - second).slice(0, max);
}

async function renderStills(target, times, guides, layer, theme, settled, max) {
  // Its own folder: a frame render of the same target may be reading <target>/ (guides must never reach a master).
  const { video, cueNames, edl, dir, placed } = build(target, { guides, settled, variant: "stills", layer, theme });
  const stillTimes = stillTimesFor(placed, times, max);
  const unsettled = settled ? unsettledStills(placed, stillTimes) : [];
  if (unsettled.length) throw new Error(unsettled.join("; "));
  // An empty --at means "5 evenly spaced frames" to HyperFrames, so a sheet with only captions takes no stills.
  if (!stillTimes.length) return console.log(`stills: none (${target} has no cue but captions)`);
  const shots = await snapshot(dir, stillTimes);
  const stillsDir = path.join(WORK, "stills", `${cueNames.join("+")}.hf${layer === "behind" ? ".behind" : ""}`);
  resetDir(stillsDir);
  const stills = shots.map((overlayPng, index) => ({
    time: stillTimes[index],
    overlayPng,
    outPng: path.join(stillsDir, `t${stillTimes[index]}.png`),
  }));
  await compositeStills(WORK, video, edl, stills);
  const kinds = new Set(placed.map((cue) => cue.kind));
  console.log(`stills: ${stillsDir} (${stillTimes.length} stills; kinds drawn: ${[...kinds].sort().join(", ")})`);
}

// Every cue's text as laid out at rest → edl/<video>.text.json, which qc/text_gates.py checks before the frames (#43).
// The card clips may not exist yet: a footage card's picture has no text to measure.
async function renderTextBoxes(target, theme) {
  const { video, dir, placed } = buildComposition(target, { variant: "boxes", theme });
  const measured = await measureText(dir, placed);
  fs.writeFileSync(path.join(WORK, "edl", `${video}.text.json`), JSON.stringify(measured, null, 1));
  console.log(`text boxes: ${measured.length} cues with text → edl/${video}.text.json`);
}

// The intro on its own (brand_intro.py): the pre-roll and split frames under `out`, plus intro.json describing them.
async function renderBrandIntro(orientation, rate, out) {
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(rate)) throw new Error(`--fps is N/D, e.g. 30000/1001, not ${rate}`);
  const [fps_num, fps_den] = rate.split("/").map(Number);
  const fps = { fps_num, fps_den };
  await takeSlot("overlay", `hf/render.js --brand-intro ${orientation} (${out})`);
  const { preroll, split, events } = brandIntroCompositions(orientation, fps, path.join(out, "hf"));
  await renderSequence(preroll.dir, fps, preroll.frames, path.join(out, "preroll"));
  await renderSequence(split.dir, fps, split.frames, path.join(out, "split"));
  // The shape of an sfx.json's intro, so sfx.mix_intro reads either.
  fs.writeFileSync(path.join(out, "intro.json"), JSON.stringify({ frames: preroll.frames, events }, null, 1));
  console.log(`brand intro (${orientation}, ${rate} fps): ${preroll.frames} pre-roll + ${split.frames} split frames → ${out}`);
}

async function main() {
  // Chrome inherits this: overlay rendering must not starve the desktop.
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const [target, ...args] = process.argv.slice(2);
  const option = (name) => optionValue(args, name);
  if (target === "--brand-intro") return renderBrandIntro(args[0], option("--fps"), path.resolve(option("--out")));
  const theme = themeFrom(args);
  if (args.includes("--events")) await progress.track(target.split(":")[0], "events", () => buildComposition(target, { events: true, theme }));
  else if (args.includes("--boxes")) await renderTextBoxes(target, theme);
  else {
    const layer = args.includes("--layer") ? option("--layer") : "front";
    const times = args.filter((arg, index) => !arg.startsWith("--") && !["--layer", "--theme", "--style", "--max"].includes(args[index - 1]));
    const max = args.includes("--max") ? Number(option("--max")) : Infinity;
    if (args.includes("--stills")) await renderStills(target, times, args.includes("--guides"), layer, theme, args.includes("--settled"), max);
    else await renderFrames(target, layer, theme, args.includes("--force"));
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });

module.exports = {
  failureText,
  childEnv,
  framesCaptured,
  stillTimesFor,
  unsettledStills,
  captionMotion,
  joinHold,
  requireClips,
  captionMarkup,
  plateKey,
  platesToDraw,
};
