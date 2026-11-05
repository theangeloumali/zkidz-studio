// Created by The Angelo Umali.
// Review-still helpers shared by both overlay renderers (render-overlays.js on canvas, hf/render.js on HyperFrames).
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const execFile = promisify(require("child_process").execFile);
const { ffmpegBin } = require("./home");

// ffmpeg composites are independent; 8 at a time measured 4.6x faster than one after another.
const COMPOSITE_JOBS = 8;

const frameSeconds = (edl) => edl.fps_den / edl.fps_num;

const frameName = (index) => `${String(index).padStart(5, "0")}.png`;
const LINKS_PER_FILE = 1000; // NTFS refuses a 1024th hard link to one file

// Every frame not yet written becomes a hard link to a copy of `blank`, a fresh copy every LINKS_PER_FILE links; a
// filesystem without hard links gets copies. Call it last: writing a frame in place would change every frame linked to it.
function fillBlanks(framesDir, frames, blank) {
  let source = null;
  let links = 0;
  for (let index = 0; index < frames; index++) {
    const frame = path.join(framesDir, frameName(index));
    if (fs.existsSync(frame)) continue;
    if (source && links < LINKS_PER_FILE) {
      try {
        fs.linkSync(source, frame);
        links++;
        continue;
      } catch {
        // falls through to a fresh copy, which the next frames link to
      }
    }
    fs.copyFileSync(blank, frame);
    source = frame;
    links = 1;
  }
}

// Empties rather than deletes: Windows refuses to remove a directory another process has open.
function resetDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
}

// Edited time → the edited frame, the source second under it and that segment's punch-in, for compositing review stills.
function sourceAt(edl, editedSeconds) {
  const frame = Math.min(edl.frames - 1, Math.round(editedSeconds / frameSeconds(edl)));
  const segment = edl.segments.find((candidate) => frame < candidate.target + candidate.out - candidate.in) ?? edl.segments.at(-1);
  // Half a frame early: ffmpeg's accurate seek drops every frame with pts < -ss, so +0.5 gave frame N+1 (none at EOF).
  return {
    frame,
    seconds: Math.max(0, (segment.in + frame - segment.target - 0.5) * frameSeconds(edl)),
    zoom: segment.zoom,
  };
}

const UHD = [2160, 3840];
const SCALE_TO_CANVAS = "scale=1080:1920:flags=lanczos";

// The footage under a still as the master frames it: a reframe's 9:16 slice of the picture band (render_final band_crop),
// else the jump-cut punch-in. Animated zooms are left out: a still shows the composition, not the camera move.
function stillBase(edl, bands, frame, sourceSeconds) {
  const reframe = (edl.reframes ?? []).find((window) => frame >= window.start && frame < window.end);
  const entry = reframe && bands.find((band) => sourceSeconds >= band.at && sourceSeconds < band.end);
  if (entry && entry.band[3] < UHD[1]) {
    const [bx, by, bw, bh] = entry.band;
    const height = bh / reframe.scale;
    const width = (height * UHD[0]) / UHD[1];
    const x = Math.min(Math.max(bx + reframe.cx * bw - width / 2, bx), bx + bw - width);
    const y = Math.min(Math.max(by + reframe.cy * bh - height / 2, by), by + bh - height);
    const share = (value) => +value.toFixed(6);
    return `crop=iw*${share(width / UHD[0])}:ih*${share(height / UHD[1])}:iw*${share(x / UHD[0])}:ih*${share(y / UHD[1])},${SCALE_TO_CANVAS}`;
  }
  const segment = edl.segments.find((candidate) => frame < candidate.target + candidate.out - candidate.in) ?? edl.segments.at(-1);
  return segment.zoom > 1 ? `${edl.punch_crop},${SCALE_TO_CANVAS}` : "null";
}

// join_sources writes the picture bands beside the source; a source without them was never letterboxed.
function readBands(work, base) {
  const file = path.join(work, "sources", `${base}.bands.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

// render_final.faces_graph on the 1080 canvas: the footage rebuilt from FACE_GRID blocks wherever the bystander mask
// (TV-range luma, backends/graph.py MASK_GRAY) marks a face, feathered at 9 px. The mask takes the footage's own crop.
const FACE_GRID = "12:21";
function facesGraph(base) {
  return (
    `[0:v]${base},format=yuv420p,split[sharp][src];[src]scale=${FACE_GRID}:flags=area,scale=1080:1920:flags=bicubic[soft];` +
    `[2:v]${base},format=yuv420p,extractplanes=y,lut=c0='clip((val-16)*255/219,0,255)',gblur=sigma=9,format=gray,` +
    "split[my][mc];[mc]scale=iw/2:ih/2,split[mu][mv];[my][mu][mv]mergeplanes=0x001020:yuv420p[mask];" +
    "[sharp][soft][mask]maskedmerge[b]"
  );
}

async function compositeStill(work, video, edl, time, overlayPng, outPng) {
  const { frame, seconds } = sourceAt(edl, time);
  const base = stillBase(edl, readBands(work, edl.base ?? video), frame, seconds);
  // A cover is published: the faces the master blurs are blurred here too (make_covers refuses a missing mask).
  const mask = edl.faces && path.join(work, edl.faces);
  const masked = mask && fs.existsSync(mask);
  await execFile(ffmpegBin(), [
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
    ...(masked ? ["-ss", seconds.toFixed(3), "-i", mask] : []),
    "-filter_complex",
    `${masked ? facesGraph(base) : `[0:v]${base}[b]`};[b][1:v]overlay=format=auto`,
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

module.exports = { resetDir, compositeStills, frameName, fillBlanks, stillBase };
