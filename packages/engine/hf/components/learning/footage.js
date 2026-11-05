// Created by The Angelo Umali.
// Footage inside the overlay: footageCard plays a cue's card clip in a rounded player that can grow to full bleed (handing
// off to the real footage) or shrink from it; gradeWipe sweeps the grade back on over the ungraded clip. `video: true`
// makes build.js give the cue its clip (src, from engine/cardclip.py) and the source frame runs it shows (ranges).
const { unit } = require("../../brand/html");
const { LEARNING } = require("../../learning/tokens");
const { spring } = require("../../fx/springs");
const { fade } = require("../../fx/motion");
const { PORTRAIT_PANEL } = require("../fx");
const { chip, chipBox } = require("./chips");
const { advanceWidth } = require("../../brand/fonts");
const { fadeOut, glyph, track } = require("./typing");
const { clipVideo, edgeOf, frameBox, timecodes } = require("./footage-parts");

const { footage: F, wipe: W, micro: MICRO } = LEARNING;
const MONO = LEARNING.type.mono;
const FULL = [0, 0, 1080, 1920];
const GRADES = ["edit", "raw"];

const where = (cue) => `${cue.kind} at ${cue.at}s`;
const chromeFade = (at, from, to) => fade(".chrome", at, { from, to, duration: F.chromeFade });
// The micro-label look at the card's smaller size, measured so file and timecode can be kept apart.
const LABEL = { ...MONO, size: F.labelSize };
const TRACKING = (MICRO.tracking * F.labelSize) / MICRO.size;
const labelWidth = (text) => advanceWidth(text, LABEL) + TRACKING * (text.length - 1);
const label = (text, x, y, extra = "") => glyph(text, x, y, LABEL, LEARNING.ink, ` fill-opacity="${MICRO.opacity}" letter-spacing="${TRACKING}"${extra}`);
const rectProps = ([left, top, width, height], radius) => ({ left, top, width, height, borderRadius: `${radius}px` });

// grow or shrink, in seconds after the cue's start; grow must end on the cue's end, where the real footage takes over.
function moveOf(cue, duration) {
  const { grow, shrink } = cue;
  if (grow && shrink) throw new Error(`${where(cue)}: one of grow or shrink, not both`);
  const move = grow ?? shrink;
  if (!move) return null;
  const name = grow ? "grow" : "shrink";
  if (!(move.dur > 0)) throw new Error(`${where(cue)}: ${name}.dur is required (seconds)`);
  const at = move.at ?? (grow ? duration - move.dur : 0);
  if (grow && Math.abs(at + move.dur - duration) > 1e-3)
    throw new Error(`${where(cue)}: grow must end at the cue's end (${duration.toFixed(3)} s in), not at ${(at + move.dur).toFixed(3)} s`);
  if (shrink && (at < 0 || at + move.dur > duration + 1e-9))
    throw new Error(`${where(cue)}: shrink (${at} + ${move.dur} s) runs past the cue's ${duration.toFixed(3)} s`);
  return { name, at, dur: move.dur };
}

// The mono chrome round the card: file and running timecode above, chips inside its top-left, progress and status under.
function chromeOf(cue, [x, y, w, h], edges, chipsAt) {
  const parts = [];
  const motion = [];
  const above = y - F.labelGap;
  const perFrame = (props) => Array.from({ length: edges.count - 1 }, (_, index) => [edges.switchAt(index + 1), props(index + 1)]);
  const file = cue.file?.toUpperCase();
  if (file) parts.push(unit("file", label(file, x, above)));
  if (cue.timecode) {
    if (!Array.isArray(cue.ranges)) throw new Error(`${where(cue)}: timecode needs the clip's source ranges (build.js sets them)`);
    const line = Math.round(F.labelSize * 1.4);
    const width = Math.ceil(labelWidth("00:00:00:00") + TRACKING);
    if (file && labelWidth(file) + F.labelGap + width > w) throw new Error(`${where(cue)}: file "${cue.file}" and the timecode overrun the ${w} px card`);
    const strip = timecodes(cue.ranges, edges.count, edges.fps)
      .map((code, index) => label(code, width, line * (index + 0.75), ' text-anchor="end"'))
      .join("");
    parts.push(frameBox("tc", [x + w - width, above - line * 0.75, width, line], unit("tc-strip", strip)));
    motion.push(
      track(
        ".tc-strip",
        edges.firstAt,
        { y: 0 },
        perFrame((index) => ({ y: -index * line })),
      ),
    );
  }
  let chipLeft = x + F.chipInset;
  for (const [index, item] of (cue.chips ?? []).entries()) {
    const part = chip(`chip chip${index}`, { tone: "ink", ...item }, [chipLeft, y + F.chipInset], { size: F.chipSize, at: chipsAt });
    chipLeft += part.width + F.chipGap;
    parts.push(part.html);
    motion.push(...part.motion);
  }
  if (cue.progress) {
    const barY = (F.headHeight - F.barHeight) / 2;
    const bar = `<rect x="0" y="${barY}" width="${w}" height="${F.barHeight}" fill="${LEARNING.ink}" fill-opacity="${F.barOpacity}"/>`;
    const played = `<rect x="${-w}" y="${barY}" width="${w}" height="${F.barHeight}" fill="${LEARNING.accent}"/>`;
    const head = `<rect x="${-F.headWidth / 2}" y="0" width="${F.headWidth}" height="${F.headHeight}" rx="${F.headWidth / 2}" fill="${LEARNING.accent}"/>`;
    parts.push(frameBox("bar", [x, y + h + F.barGap, w, F.headHeight], unit("track", bar) + unit("head", played + head)));
    const step = w / Math.max(1, edges.count - 1);
    motion.push(
      track(
        ".head",
        edges.firstAt,
        { x: 0 },
        perFrame((index) => ({ x: index * step })),
      ),
    );
  }
  if (cue.status) parts.push(unit("status", label(cue.status.toUpperCase(), x, y + h + F.statusGap)));
  return { html: parts.join(""), motion };
}

const footageCard = {
  video: true,
  sfx(cue, duration) {
    const move = moveOf(cue, duration);
    return move ? [{ at: move.at, sound: "swish" }] : [];
  },
  render(cue, { id, duration, fps }) {
    if (cue.grade !== undefined && !GRADES.includes(cue.grade)) throw new Error(`${where(cue)}: grade is ${GRADES.join(" or ")}, not ${cue.grade}`);
    const rect = cue.rect ?? PORTRAIT_PANEL;
    const move = moveOf(cue, duration);
    const edges = edgeOf(cue, fps);
    const card = rectProps(rect, cue.radius ?? F.radius);
    const full = rectProps(FULL, 0);
    const start = move?.name === "shrink" ? full : card;
    const style = `left:${start.left}px;top:${start.top}px;width:${start.width}px;height:${start.height}px;border-radius:${start.borderRadius};overflow:hidden;box-shadow:${F.shadow}`;
    const chrome = chromeOf(cue, rect, edges, move?.name === "shrink" ? move.at + move.dur : 0);
    const html = `<div class="footage"><div class="box card" style="${style}">${clipVideo(cue, id, edges)}</div>${unit("chrome", "", [0, 0], chrome.html)}</div>`;
    const motion = [...chrome.motion];
    if (move?.name === "grow") {
      // Full bleed on the last drawn frame: the next frame is the real footage, so the hand-off cannot show.
      const travel = edges.lastAt - move.at;
      if (travel <= 0) throw new Error(`${where(cue)}: grow starts after the cue's last frame`);
      motion.push({ target: ".card", at: move.at, from: card, to: { ...full, duration: travel, ease: "power3.inOut" } });
      motion.push(chromeFade(move.at, 1, 0));
    } else if (move) {
      motion.push({ target: ".card", at: move.at, from: full, to: { ...card, duration: move.dur, ease: "power3.inOut" } });
      motion.push(chromeFade(move.at + move.dur, 0, 1));
    } else {
      motion.push({ target: ".card", at: 0, from: { scale: F.enterScale, opacity: 0 }, to: { scale: 1, opacity: 1, ...spring("standard") } });
      motion.push(chromeFade(0, 0, 1));
    }
    return { html, motion, exit: move ? [] : fadeOut(".footage", duration) };
  },
};

// The ungraded clip full frame over the graded master, clipped to the divider's right as it sweeps across.
const gradeWipe = {
  video: true,
  clipGrade: () => "raw",
  sfx: (cue) => [{ at: cue.wipeAt, sound: "swish" }],
  render(cue, { id, duration, fps }) {
    if (cue.grade !== undefined && cue.grade !== "raw") throw new Error(`${where(cue)}: the wipe's clip is always raw, not ${cue.grade}`);
    const { wipeAt } = cue;
    if (typeof wipeAt !== "number" || wipeAt < 0 || wipeAt + W.sweep > duration + 1e-9)
      throw new Error(`${where(cue)}: wipeAt ${wipeAt} must leave the ${W.sweep} s sweep before the cue's end (${duration.toFixed(3)} s)`);
    const graded = chipBox("Graded", W.chipSize);
    const left = chip("chip chip-graded", { text: "Graded", tone: "accent" }, [-W.chipGap - graded.width, W.chipTop], { size: W.chipSize, at: wipeAt });
    const right = chip("chip chip-ungraded", { text: "Ungraded", tone: "ink" }, [W.chipGap, W.chipTop], { size: W.chipSize, at: wipeAt });
    const divider = `<rect x="${-W.divider / 2}" y="0" width="${W.divider}" height="1920" fill="${LEARNING.accent}"/>`;
    const html =
      frameBox("raw", FULL, clipVideo(cue, id, edgeOf(cue, fps))) +
      unit("wipe-chrome", "", [0, 0], unit("divider", divider) + unit("riders", "", [0, 0], left.html + right.html));
    const sweep = (target, from, to) => ({ target, at: wipeAt, from, to: { ...to, duration: W.sweep, ease: "power2.inOut" } });
    const settle = Math.max(wipeAt + W.sweep, duration - LEARNING.exit);
    const leave = { opacity: 0, duration: duration - settle, ease: "power2.in", immediateRender: false };
    const exit = settle < duration ? [{ target: ".wipe-chrome", at: settle, from: { opacity: 1 }, to: leave }] : [];
    return {
      html,
      motion: [
        { target: ".wipe-chrome", at: wipeAt, from: { opacity: 0 }, to: { opacity: 1, duration: W.show, ease: "power2.out" } },
        sweep(".raw", { clipPath: "inset(0px 0px 0px 0px)" }, { clipPath: "inset(0px 0px 0px 1080px)" }),
        sweep(".divider", { x: 0 }, { x: 1080 }),
        sweep(".riders", { x: 0 }, { x: 1080 }),
        ...left.motion,
        ...right.motion,
      ],
      exit,
    };
  },
};

module.exports = { footageCard, gradeWipe };
