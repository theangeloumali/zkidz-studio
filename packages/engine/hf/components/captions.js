// Created by The Angelo Umali.
// English caption plate, drawn by the canvas page's own caption component (ink plate, goldBright edge, at most two lines,
// bottom 1430). Crisp on purpose, as on canvas: no effects. Captions timemap.js joins swap in place without a fade.
// `style: "words"` (captions.py --words) is HF-native instead: one line built word by word on the learning tokens.
const { rise, exit } = require("../fx/motion");
const { k, SETTLED, drawn } = require("./parts");
const { unit } = require("../brand/html");
const { num, escapeXml } = require("../brand/recorder");
const { advanceWidth } = require("../brand/fonts");
const { LEARNING } = require("../learning/tokens");
const { onCover } = require("../learning/cover");

const RISE = 10; // px: the plate's lift, mirrored by render.js's caption layer
const FRAME = { width: 1080, height: 1920, side: 40 };
const JOIN_FADE_FRAMES = 3;

// A words state after the first of its line: it fades in over the state before it, which render.js holds underneath.
const continuesLine = (cue) => cue.style === "words" && Boolean(cue.joinsBefore) && cue.text.split(" ").length > 1;
// Its alpha on each fade frame, from 0 one frame before its first: power1.out, which the page tween uses too.
const joinAlpha = (frame) => 1 - (1 - (frame + 1) / (JOIN_FADE_FRAMES + 1)) ** 2;
const joinFade = (fps) => [
  { target: ".plate", at: -1 / fps, from: { opacity: 0 }, to: { opacity: 1, duration: (JOIN_FADE_FRAMES + 1) / fps, ease: "power1.out" } },
];

// The baseline after the house dodge: a name plate this state meets in time lifts it above the plate.
function dodgedBaseline(cue, cues, baseline, above, below) {
  const [start, stop] = cue.dodge ?? [cue.start, cue.stop];
  const plates = cues.filter((other) => k.BAND_OWNERS[other.kind] && other.start < stop && other.stop > start).map((other) => k.BAND_OWNERS[other.kind](other));
  const clashing = plates.filter(([top, bottom]) => top < baseline + below && bottom > baseline - above);
  return Math.min(baseline, ...clashing.map(([top]) => top - k.CAPTION_DODGE - below));
}

// Every word placed where the whole line puts it, so the words a state shares with the next sit on the same pixels.
function wordsLayout(cue, cues) {
  const { caption, type } = LEARNING;
  const font = { family: type.caption.family, weight: type.caption.weight, size: type.caption.size * (cue.scale ?? 1) };
  const line = (cue.line ?? cue.text).split(" ");
  const said = cue.text.split(" ");
  if (said.some((word, index) => word !== line[index])) throw new Error(`words caption "${cue.text}" is not the start of its line "${cue.line}"`);
  const pills = new Set(cue.pills ?? []);
  const pad = (index) => (pills.has(index) ? caption.pillPadX : 0);
  const space = advanceWidth(" ", font);
  const widths = line.map((word) => advanceWidth(word, font));
  const total = widths.reduce((sum, width, index) => sum + width + 2 * pad(index), space * (line.length - 1));
  if (total > FRAME.width - 2 * FRAME.side) throw new Error(`words caption "${line.join(" ")}" is ${Math.round(total)} px wide at scale ${cue.scale ?? 1}`);
  let x = (FRAME.width - total) / 2;
  const words = line.map((word, index) => {
    const placed = { word, x: x + pad(index), width: widths[index], pill: pills.has(index) };
    x += widths[index] + 2 * pad(index) + space;
    return placed;
  });
  const above = caption.ascent * font.size + caption.pillPadY;
  const below = caption.descent * font.size + caption.pillPadY;
  const placed = Math.min(Math.max(cue.bottom ?? caption.bottom, above), FRAME.height - below);
  const baseline = Math.max(dodgedBaseline(cue, cues, placed, above, below), above);
  return { font, baseline, above, below, words: words.slice(0, said.length) };
}

function wordsPlate(cue, cues) {
  const { font, baseline, above, below, words } = wordsLayout(cue, cues);
  const { caption } = LEARNING;
  const paper = onCover(cue, cues);
  const shadow = `s${cue.seed}-shadow`;
  const pill = ({ x, width }) =>
    `<rect class="pill" x="${num(x - caption.pillPadX)}" y="${num(baseline - above)}" width="${num(width + 2 * caption.pillPadX)}" ` +
    `height="${num(above + below)}" rx="${caption.pillRadius}" fill="${LEARNING.accent}"/>`;
  const text = ({ word, x, pill: onPill }) =>
    `<text x="${num(x)}" y="${num(baseline)}" fill="${onPill || paper ? LEARNING.ink : LEARNING.white}" style="white-space:pre">${escapeXml(word)}</text>`;
  const defs = paper
    ? ""
    : `<defs><filter id="${shadow}" x="-10%" y="-40%" width="120%" height="180%">` +
      `<feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000000" flood-opacity="0.5"/></filter></defs>`;
  const pills = words.filter((word) => word.pill).map(pill);
  const group =
    `<g${paper ? "" : ` filter="url(#${shadow})"`} font-family="${escapeXml(font.family)}" font-weight="${font.weight}" font-size="${num(font.size)}">` +
    `${pills.join("")}${words.map(text).join("")}</g>`;
  return unit("plate words", defs + group);
}

const caption = {
  track: 3,
  // build.js splits a words state at each cover edge it crosses, so each piece is wholly ink on paper or white on footage.
  splitsAtCovers: (cue) => cue.style === "words",
  render(cue, { duration, cues, fps }) {
    const entrance = cue.joinsBefore ? [] : rise(".plate", 0, { distance: RISE, scaleFrom: 1 });
    // The canvas fades a caption by its envelope's exit, without the lift other cues get.
    const exits = cue.joinsAfter ? [] : exit(".plate", duration, { fadeOnly: true });
    // atRest: the plates pass, whose snapshot must be opaque; caption_layer.py applies the join fade itself.
    const words = continuesLine(cue) && !cue.atRest ? joinFade(fps) : entrance;
    if (cue.style === "words") return { html: wordsPlate(cue, cues), motion: words, exit: exits };
    // The canvas asks activeCues frame by frame; a name plate overlapping any moment of this caption lifts it for its span.
    const owners = cues.filter((other) => k.BAND_OWNERS[other.kind] && other.start < cue.stop && other.stop > cue.start);
    const plate = k.COMPONENTS.caption;
    return {
      html: drawn(cue, "plate", () => plate(cue, { local: SETTLED, duration, exit: 0 }), undefined, { active: owners }),
      motion: entrance,
      exit: exits,
    };
  },
};

module.exports = { caption, RISE, JOIN_FADE_FRAMES, continuesLine, joinAlpha };
