// Created by The Angelo Umali.
// Review-still helpers shared by both overlay renderers (render-overlays.js on canvas, hf/render.js on HyperFrames).
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const execFile = promisify(require("child_process").execFile);

// ffmpeg composites are independent; 8 at a time measured 4.6x faster than one after another.
const COMPOSITE_JOBS = 8;

const frameSeconds = (edl) => edl.fps_den / edl.fps_num;
const savePng = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));

// Empties rather than deletes: Windows refuses to remove a directory another process has open.
function resetDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
}

// Edited time → the source frame and zoom under it, for compositing review stills.
function sourceAt(edl, editedSeconds) {
  const frame = Math.min(edl.frames - 1, Math.round(editedSeconds / frameSeconds(edl)));
  const segment = edl.segments.find((candidate) => frame < candidate.target + candidate.out - candidate.in) ?? edl.segments.at(-1);
  // Half a frame early: ffmpeg's accurate seek drops every frame with pts < -ss, so +0.5 gave frame N+1 (none at EOF).
  return {
    seconds: Math.max(0, (segment.in + frame - segment.target - 0.5) * frameSeconds(edl)),
    zoom: segment.zoom,
  };
}

async function compositeStill(work, video, edl, time, overlayPng, outPng) {
  const { seconds, zoom } = sourceAt(edl, time);
  const base = zoom > 1 ? `${edl.punch_crop},scale=1080:1920:flags=lanczos` : "null";
  await execFile("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-ss",
    seconds.toFixed(3),
    "-i",
    // A Reels edit reuses its full edit's proxy.
    path.join(work, "mezz", `${edl.base ?? video}.mp4`),
    "-i",
    overlayPng,
    "-filter_complex",
    `[0:v]${base}[b];[b][1:v]overlay=format=auto`,
    "-frames:v",
    "1",
    outPng,
  ]);
  // ffmpeg exits 0 with "Output file is empty" when the seek finds no frame.
  if (!fs.existsSync(outPng)) throw new Error(`still t${time}: no source frame at ${seconds.toFixed(3)} s`);
}

// Composites every still ({ time, overlayPng, outPng }) onto the proxy, COMPOSITE_JOBS at a time.
async function compositeStills(work, video, edl, stills) {
  const queue = [...stills];
  const worker = async () => {
    for (let still = queue.shift(); still; still = queue.shift()) await compositeStill(work, video, edl, still.time, still.overlayPng, still.outPng);
  };
  await Promise.all(Array.from({ length: COMPOSITE_JOBS }, worker));
}

module.exports = { frameSeconds, savePng, resetDir, compositeStills };
