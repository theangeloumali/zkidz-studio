// Created by The Angelo Umali.
// Draws an edit's brand overlay track with HyperFrames into the contract render_final.py reads: frames/<video>/00000.png …,
// one transparent 1080x1920 PNG per edited frame. Argument-compatible with render-overlays.js. From the work dir (or ZKS_WORK):
//   node <engine>/hf/render.js v4r:v4+v4r+v4-cc            → frames/v4r/ (+ frames/v4r.intro/ for an intro hook)
//   … --stills auto | 3.2 41.5 [--guides]                  → stills/<cues>.hf/t3.2.png, composited on the proxy
//   … --events                                             → edl/<video>.sfx.json only (for sfx.py)
//   … --theme minimal                                       → draws in themes/minimal's look (default themes/zkidz)
//   … --layer behind [--stills …]                          → frames/<video>.behind/ (stills/<cues>.hf.behind/): only the
//                                                            depth "behind" cues, which render_final.py lays under the matte
//   node <engine>/hf/render.js --brand-intro landscape --fps 30000/1001 --out DIR   → DIR/preroll/, DIR/split/ (brand_intro.py)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { build, brandIntroCompositions } = require("./build");
const { DEFAULT_THEME } = require("./theme");
const { EXIT_SECONDS } = require("./fx/motion");
const progress = require("./progress");
const { ffmpegBin } = require("./home");
const { takeSlot } = require("./slots");
const { resetDir, compositeStills } = require("./stills");

const WORK = process.env.ZKS_WORK || process.cwd();
const HF_PACKAGE = path.join(__dirname, "node_modules", "hyperframes");
const HF_BIN = path.join(HF_PACKAGE, require(path.join(HF_PACKAGE, "package.json")).bin.hyperframes);
// Nothing leaves the machine: no telemetry, no update check or self-install, and snapshots never go to Gemini (--describe false).
const LOCAL_ONLY = { DO_NOT_TRACK: "1", HYPERFRAMES_NO_TELEMETRY: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_AUTO_INSTALL: "1" };
const RENDER_WORKERS = "8"; // measured: 16 workers capture no faster than 8 (docs/hyperframes.md)
const HF_FRAME = /^frame_(\d{6})\.png$/;

// A failed child as text: its stderr, else its stdout, else the error, and always how it ended. An empty stderr Buffer is
// truthy, so `stderr || message` printed nothing.
function failureText(error) {
  const output = [error.stderr, error.stdout].map((stream) => String(stream ?? "").trim()).find(Boolean) ?? error.message;
  return `${output.slice(-4000)}\n(${error.signal ? `killed by ${error.signal}` : `exit code ${error.status}`})`;
}

const OUTPUT_TAIL = 64 * 1024; // of each stream, kept for the failure message

// Runs the HyperFrames CLI; `onOutput` sees its output as it arrives (a render's "Capturing frame N/M" lines).
function hyperframes(args, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HF_BIN, ...args], { env: { ...process.env, ...LOCAL_ONLY }, stdio: ["ignore", "pipe", "pipe"] });
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
  pngs.forEach((file, index) => fs.renameSync(path.join(staging, file), path.join(framesDir, `${String(index).padStart(5, "0")}.png`)));
  fs.rmSync(staging, { recursive: true, force: true });
  withAlpha(framesDir);
}

async function renderFrames(target, layer, theme) {
  const draw = layer === "behind" ? drawBehind : drawFrames;
  await progress.track(target.split(":")[0], layer === "behind" ? "behind" : "frames", (stage) => draw(target, stage, theme));
}

// The behind layer: frames/<video>.behind/, on the same frame grid as frames/<video>/. A sheet with no behind cue leaves no
// folder, so a stale one from an earlier sheet never reaches the composite.
async function drawBehind(target, stage, theme) {
  await takeSlot("overlay", `hf/render.js ${target} --layer behind (${WORK})`, stage.wait);
  const { video, edl, dir, placed } = build(target, { layer: "behind", theme });
  const framesDir = path.join(WORK, "frames", `${video}.behind`);
  if (!placed.length) {
    fs.rmSync(framesDir, { recursive: true, force: true });
    return console.log(`${video}: no depth "behind" cue, so no behind layer`);
  }
  stage.begin(edl.frames, edl.frames);
  const started = Date.now();
  await renderSequence(dir, edl, edl.frames, framesDir, stage.update);
  console.log(`${video}: ${edl.frames} behind-layer frames (${placed.length} cues) drawn in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

async function drawFrames(target, stage, theme) {
  await takeSlot("overlay", `hf/render.js ${target} (${WORK})`, stage.wait);
  const { video, edl, dir, intro, placed } = build(target, { theme });
  stage.begin(edl.frames + (intro?.frames ?? 0), edl.frames);
  const started = Date.now();
  await renderSequence(dir, edl, edl.frames, path.join(WORK, "frames", video), stage.update);
  // The brand pre-roll render_final.py splices in; a stale one from an earlier sheet must not survive.
  if (intro) await renderSequence(intro.dir, edl, intro.frames, path.join(WORK, "frames", `${video}.intro`), (frames) => stage.update(edl.frames + frames));
  else fs.rmSync(path.join(WORK, "frames", `${video}.intro`), { recursive: true, force: true });
  // The insert these frames carry the Z-split at: render_final checks it against sfx.py's.
  const split = placed.find((cue) => cue.kind === "brandSplit");
  const insertFile = path.join(WORK, "frames", `${video}.insert.json`);
  if (split) fs.writeFileSync(insertFile, JSON.stringify({ at: split.firstFrame }));
  else fs.rmSync(insertFile, { force: true });
  const drawn = edl.frames + (intro?.frames ?? 0);
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `${video}: ${drawn} frames drawn by HyperFrames in ${seconds.toFixed(0)} s (${(drawn / seconds).toFixed(1)} fps)${intro ? `, ${intro.frames} of them the brand intro` : ""}`,
  );
}

// "auto" = one still per non-caption cue just before its exit, when every item has landed (captions show on every still).
const SETTLED_BEFORE_EXIT = EXIT_SECONDS + 0.1;
const autoTimes = (placed) =>
  placed.filter((cue) => cue.kind !== "caption").map((cue) => +Math.max(cue.start + (cue.stop - cue.start) / 2, cue.stop - SETTLED_BEFORE_EXIT).toFixed(2));

async function renderStills(target, times, guides, layer, theme) {
  // Its own folder: a frame render of the same target may be reading <target>/ (guides must never reach a master).
  const { video, cueNames, edl, dir, placed } = build(target, { guides, variant: "stills", layer, theme });
  const stillTimes = [...new Set(times[0] === "auto" ? autoTimes(placed) : times.map(Number))];
  // An empty --at means "5 evenly spaced frames" to HyperFrames, so a sheet with only captions takes no stills.
  if (!stillTimes.length) return console.log(`stills: none (${target} has no cue but captions)`);
  const snapshots = path.join(dir, "snapshots");
  resetDir(snapshots);
  await hyperframes(["snapshot", dir, "--at", stillTimes.join(","), "--describe", "false", "--no-end"]);
  // Snapshots are named frame-<index>-at-<time>.png, index in --at order.
  const shots = fs
    .readdirSync(snapshots)
    .map((name) => [Number(/^frame-(\d+)-at-/.exec(name)?.[1]), name])
    .filter(([index]) => Number.isInteger(index))
    .sort((first, second) => first[0] - second[0]);
  if (shots.length !== stillTimes.length) throw new Error(`snapshot wrote ${shots.length} frames for ${stillTimes.length} times`);
  const stillsDir = path.join(WORK, "stills", `${cueNames.join("+")}.hf${layer === "behind" ? ".behind" : ""}`);
  resetDir(stillsDir);
  const stills = shots.map(([index, name]) => ({
    time: stillTimes[index],
    overlayPng: path.join(snapshots, name),
    outPng: path.join(stillsDir, `t${stillTimes[index]}.png`),
  }));
  await compositeStills(WORK, video, edl, stills);
  const kinds = new Set(placed.map((cue) => cue.kind));
  console.log(`stills: ${stillsDir} (${stillTimes.length} stills; kinds drawn: ${[...kinds].sort().join(", ")})`);
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
  // A missing flag fails rather than taking the next argument: --out's preroll/ and split/ are emptied.
  const option = (name) => {
    const value = args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} is required`);
    return value;
  };
  if (target === "--brand-intro") return renderBrandIntro(args[0], option("--fps"), path.resolve(option("--out")));
  const theme = args.includes("--theme") ? option("--theme") : DEFAULT_THEME;
  if (args.includes("--events")) await progress.track(target.split(":")[0], "events", () => build(target, { events: true, theme }));
  else {
    const layer = args.includes("--layer") ? option("--layer") : "front";
    const times = args.filter((arg, index) => !arg.startsWith("--") && !["--layer", "--theme"].includes(args[index - 1]));
    if (args.includes("--stills")) await renderStills(target, times, args.includes("--guides"), layer, theme);
    else await renderFrames(target, layer, theme);
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });

module.exports = { failureText, framesCaptured };
