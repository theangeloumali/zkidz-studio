// Created by The Angelo Umali.
// bigWord's live motions (#20): `slot`, a fixed line over one masked slot that rolls between words on their pins
// (storyboard 06), and `scribbleAt`, fast seeded orange pen loops that scribble the word out (storyboard 07).
const { unit, drawable } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { canvasBrand } = require("../../brand/canvas");
const { drawOn } = require("../../fx/ink");
const { LEARNING } = require("../../learning/tokens");
const { glyph, rectClip } = require("./typing");

const { big: BIG } = LEARNING;
const { mulberry32 } = canvasBrand().scope;
const SLOT = { fixed: 0.67, fixedGap: 34, pad: 0.22, roll: 0.45, rule: 4, ruleWidth: 940, exit: 0.7, exitRise: 0.6, exitBlur: 8 };

function slotBody(cue, { font, colour, x, baseline }, refuseWide) {
  const words = [...cue.slot.words].sort((a, b) => a.at - b.at).map((word) => ({ ...word, text: word.text.toUpperCase() }));
  const widths = words.map((word) => advanceWidth(word.text, font));
  words.forEach((word, index) => refuseWide(word.text, widths[index], font.size));
  const [top, bottom] = [baseline - (BIG.ascent + SLOT.pad) * font.size, baseline + (BIG.descent + SLOT.pad) * font.size];
  const line = bottom - top;
  const fixedFont = { ...font, size: Math.round(font.size * SLOT.fixed) };
  const fixed = (cue.slot.fixed ?? "").toUpperCase();
  const rule = (y) =>
    `<rect x="${num(x - SLOT.ruleWidth / 2)}" y="${num(y - SLOT.rule / 2)}" width="${SLOT.ruleWidth}" height="${SLOT.rule}" rx="2" fill="${LEARNING.accent}"/>`;
  const svg = (fixed ? glyph(fixed, x, top - SLOT.fixedGap, fixedFont, colour, ' text-anchor="middle" letter-spacing="4"') : "") + rule(top) + rule(bottom);
  const motion = [];
  const units = words.map((word, index) => {
    const name = `sw${index}`;
    motion.push({ target: `.${name}`, at: word.at, from: { y: line }, to: { y: 0, duration: SLOT.roll, ease: "power3.out" } });
    const next = words[index + 1];
    if (next)
      motion.push({
        target: `.${name}`,
        at: next.at,
        from: { y: 0, opacity: 1, filter: "blur(0px)" },
        to: { y: -SLOT.exitRise * line, opacity: 0, filter: `blur(${SLOT.exitBlur}px)`, duration: SLOT.exit, ease: "power2.out", immediateRender: false },
      });
    return unit(name, glyph(word.text, x, baseline, font, word.color ?? colour, ' text-anchor="middle"'));
  });
  const html = `<div class="u slot-window" style="clip-path:${rectClip(x - SLOT.ruleWidth / 2, top - line, x + SLOT.ruleWidth / 2, bottom - SLOT.rule)}">${units.join("")}</div>`;
  return { svg, html, motion, landing: null, ticks: words.map((word) => word.at), width: Math.max(...widths) };
}

// Two cursive passes across the word's middle band, seeded per cue, drawn on fast one after the other.
function scribble(cue, { font, x, baseline }, width) {
  if (cue.scribbleAt === undefined) return { html: "", motion: [] };
  const rand = mulberry32(cue.seed * 17 + 3);
  const [left, span] = [x - width / 2 - 0.08 * font.size, width + 0.16 * font.size];
  const middle = baseline - 0.36 * font.size;
  const pass = (amp, loops, phase) => {
    const points = Array.from({ length: 161 }, (_, index) => {
      const t = index / 160;
      const turn = t * 2 * Math.PI * loops + phase;
      return `${num(left + t * span + 0.18 * font.size * Math.sin(turn))} ${num(middle + amp * Math.cos(turn) + 0.05 * font.size * Math.sin(t * 23 + phase))}`;
    });
    return `M${points.join(" L")}`;
  };
  const loops = Math.max(4, Math.round(span / (0.45 * font.size)));
  const strokes = [
    [0.19, loops + rand() * 2, rand() * 6, 0.064],
    [0.16, loops - 1 + rand() * 2, rand() * 6, 0.053],
  ];
  const html = strokes
    .map(([amp, turns, phase, weight], index) =>
      unit(
        `scrib scrib${index}`,
        drawable(
          `<path d="${pass(amp * font.size, turns, phase)}" fill="none" stroke="${LEARNING.accentInk}" stroke-width="${num(weight * font.size)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        ),
      ),
    )
    .join("");
  const motion = strokes.map((_, index) => drawOn(`.scrib${index} path`, cue.scribbleAt + index * 0.16, { duration: 0.34 }));
  return { html: `<div class="u pen-shadow" style="filter:drop-shadow(0 6px 10px rgba(120,40,0,.25))">${html}</div>`, motion };
}

module.exports = { slotBody, scribble };
