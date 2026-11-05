// Created by The Angelo Umali.
// Shared by the footage kinds (footage.js): a cue's frame edges on the edit, its <video>, a clipping box, and the source
// timecode of each drawn frame.
const { px } = require("../../brand/html");

const CLIP_LEAD = 0.25; // frames: the clip wrapper's own lead (compose.js), so each seek lands inside its frame
const FRAME_EPSILON = 1e-6;
const frameAtOrAfter = (time, fps) => Math.ceil(time * fps - FRAME_EPSILON);
const seconds = (value) => value.toFixed(9);

// The cue's drawn frames [first, end) as compose.js places them, and times on them in seconds after the cue's start.
// A per-frame switch goes mid-frame, so no seek can land on its edge.
function edgeOf(cue, fps) {
  const first = frameAtOrAfter(cue.start, fps);
  const end = frameAtOrAfter(cue.stop, fps);
  const local = (frame) => frame / fps - cue.start;
  return { fps, first, end, count: end - first, firstAt: local(first), lastAt: local(end - 1), switchAt: (index) => local(first + index - 0.5) };
}

// HyperFrames times the video in composition seconds; a clip shifted before its window (a span render) starts at 0 and
// skips that far into its media instead.
function clipVideo(cue, id, edges) {
  if (typeof cue.src !== "string" || !cue.src) throw new Error(`${cue.kind} at ${cue.at}s: no clip src (build.js sets it from engine/cardclip.py's clip)`);
  const lead = edges.first - CLIP_LEAD;
  const start = Math.max(0, lead) / edges.fps;
  const mediaStart = Math.max(0, -lead) / edges.fps;
  const duration = edges.count / edges.fps - mediaStart;
  return (
    `<video id="${id}-clip" class="clip" muted playsinline src="${cue.src}" data-start="${seconds(start)}" data-duration="${seconds(duration)}"` +
    `${mediaStart ? ` data-media-start="${seconds(mediaStart)}"` : ""} style="width:100%;height:100%;object-fit:cover;display:block"></video>`
  );
}

const frameBox = (className, [x, y, w, h], inner) =>
  `<div class="box ${className}" style="left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)};overflow:hidden">${inner}</div>`;

// Non-drop HH:MM:SS:FF of each drawn frame's source frame, the way a camera counts (FF runs 00–29 at 29.97).
function timecodes(ranges, count, fps) {
  const base = Math.round(fps);
  const sources = ranges.flatMap(([from, to]) => Array.from({ length: to - from }, (_, index) => from + index)).slice(0, count);
  const two = (value) => String(value).padStart(2, "0");
  return sources.map((frame) => {
    const whole = Math.floor(frame / base);
    return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60, frame % base].map(two).join(":");
  });
}

module.exports = { edgeOf, clipVideo, frameBox, timecodes, frameAtOrAfter };
