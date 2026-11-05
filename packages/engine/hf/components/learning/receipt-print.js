// Created by The Angelo Umali.
// receiptPrint (storyboard 15): a navy printer slot feeds a paper receipt out line by line on its pins, a torn edge at the
// foot; on `totalAt` the last row feeds out and its total rolls like an odometer, landing orange.
const { unit } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { rise } = require("../../fx/motion");
const { LEARNING } = require("../../learning/tokens");
const { glyph, fadeOut, glideTrack } = require("./typing");
const { odometerColumns, odometerStrip } = require("./odometer");

const SLOT = { w: 580, h: 76 };
const PAPER = { w: 468, pad: 34, under: 14, titleY: 70, firstLine: 160, line: 52, tear: 14, glide: 0.22, roll: 0.7 };
const MONO = LEARNING.type.mono;
const TOTAL = { ...LEARNING.type.display, size: 84 };

function layout(cue) {
  const lines = (cue.lines ?? []).map((line, index) => {
    const text = line.text.toUpperCase();
    const font = { ...MONO, weight: 600, size: 30 };
    const room = PAPER.w - 2 * PAPER.pad - 24;
    if (advanceWidth(text, font) + advanceWidth(String(line.value ?? ""), font) > room)
      throw new Error(`receiptPrint line "${line.text}" is wider than the receipt`);
    if (line.at > cue.totalAt) throw new Error(`receiptPrint line "${line.text}" at ${line.at} prints after totalAt ${cue.totalAt}`);
    return { ...line, text, font, baseline: PAPER.firstLine + index * PAPER.line };
  });
  const rule = PAPER.firstLine + Math.max(lines.length - 1, 0) * PAPER.line + 40;
  const totalY = rule + 74;
  const length = totalY + 44 + PAPER.tear;
  const [x, y] = [cue.x ?? 540, cue.y ?? 120];
  return { lines, rule, totalY, length, slotLeft: x - SLOT.w / 2, paperLeft: x - PAPER.w / 2, paperTop: y + SLOT.h - PAPER.under, slotTop: y };
}

// The paper unrolls from the slot on each pin, title first: a clip opening down to each stage's reveal.
const feed = (stages, length) => {
  const shown = (reveal) => ({ clipPath: `inset(0px 0px ${num(length - reveal)}px 0px)` });
  return glideTrack(
    ".rp-reveal",
    shown(0),
    stages.map(({ at, reveal }) => [at, shown(reveal)]),
    { glide: PAPER.glide },
  );
};

// The total's columns, each a clipped strip that rolls from `from` down to the total.
function total(cue, { totalY }) {
  const from = cue.totalFrom ?? cue.total + 5;
  const columns = odometerColumns([from, cue.total]);
  const cell = advanceWidth("0", TOTAL);
  const right = PAPER.w - PAPER.pad;
  const line = 1.1 * TOTAL.size;
  const [top, height] = [totalY - 0.78 * TOTAL.size, 0.9 * TOTAL.size];
  let svg = "";
  const motion = columns.flatMap(({ digits, rows }, index) => {
    const left = right - (columns.length - index) * cell;
    svg += odometerStrip(`s${cue.seed}-rp${index}`, { digits, rows }, [left, top, cell, height], {
      baseline: totalY,
      line,
      font: TOTAL,
      colour: LEARNING.accentInk,
      group: `class="rp-roll${index}"`,
    });
    if (rows[1] === rows[0]) return [];
    return [{ target: `.rp-roll${index}`, at: cue.totalAt, from: { y: 0 }, to: { y: -(rows[1] - rows[0]) * line, duration: PAPER.roll, ease: "power3.out" } }];
  });
  return { html: unit("rp-total", svg), motion };
}

function tornEdge(length) {
  const teeth = Array.from({ length: 13 }, (_, index) => `${num(100 - (index + 0.5) * 7.69)}% ${index % 2 ? `${length - PAPER.tear}px` : "100%"}`);
  return `polygon(0 0, 100% 0, 100% ${length - PAPER.tear}px, ${teeth.join(", ")}, 0 ${length - PAPER.tear}px)`;
}

const receiptPrint = {
  sfx(cue) {
    return [...(cue.lines ?? []).map((line) => ({ at: line.at, sound: "type", dur: PAPER.glide })), { at: cue.totalAt, sound: "count", dur: PAPER.roll }];
  },
  render(cue, { duration }) {
    const placed = layout(cue);
    const { lines, rule, totalY, length } = placed;
    const ink = LEARNING.ink;
    const dash = (y) =>
      `<line x1="${PAPER.pad}" x2="${PAPER.w - PAPER.pad}" y1="${y}" y2="${y}" stroke="${ink}" stroke-opacity="0.35" stroke-width="3" stroke-dasharray="9 7"/>`;
    const title = { ...MONO, weight: 700, size: 34 };
    const body =
      glyph((cue.title ?? "Receipt").toUpperCase(), PAPER.w / 2, PAPER.titleY, title, ink, ' text-anchor="middle" letter-spacing="4"') +
      dash(PAPER.titleY + 36) +
      lines
        .map(
          (line) =>
            glyph(line.text, PAPER.pad, line.baseline, line.font, ink) +
            glyph(String(line.value ?? ""), PAPER.w - PAPER.pad, line.baseline, line.font, ink, ' text-anchor="end"'),
        )
        .join("") +
      dash(rule) +
      glyph("TOTAL", PAPER.pad, totalY, { ...MONO, weight: 700, size: 32 }, ink);
    const roll = total(cue, placed);
    const paper =
      `<div class="u rp-paper" style="width:${PAPER.w}px;height:${length}px;clip-path:${tornEdge(length)};` +
      `background:linear-gradient(180deg,#D9D3C6 0,#FFFDF8 40px,#FFFDF8 80%,#EDE7DA)">${unit("rp-body", body)}${roll.html}</div>`;
    const window =
      `<div class="box rp-window" style="left:${num(placed.paperLeft)}px;top:${num(placed.paperTop)}px;width:${PAPER.w}px;height:${length + 40}px;` +
      `overflow:hidden;perspective:900px;filter:drop-shadow(0 26px 24px rgba(10,16,24,.35))">` +
      `<div class="u rp-tilt" style="width:${PAPER.w}px;transform:rotateX(-9deg);transform-origin:50% 0">` +
      `<div class="rp-reveal" style="position:relative;width:${PAPER.w}px;height:${length}px;clip-path:inset(0px 0px ${length}px 0px)">${paper}</div></div></div>`;
    const slot =
      `<div class="box rp-slot" style="left:${num(placed.slotLeft)}px;top:${num(placed.slotTop)}px;width:${SLOT.w}px;height:${SLOT.h}px;border-radius:22px;` +
      `background:linear-gradient(180deg,#2B3A50,${ink});box-shadow:${LEARNING.shade.shadow},inset 0 2px 0 rgba(255,255,255,.15)">` +
      `<div style="position:absolute;left:44px;right:44px;bottom:12px;height:10px;border-radius:5px;background:#05080C"></div>` +
      unit(
        "rp-led",
        `<circle cx="30" cy="26" r="6" fill="${LEARNING.accentInk}"/>` +
          glyph("PRINTING", 46, 33, { ...MONO, weight: 600, size: 20 }, LEARNING.accent, ' letter-spacing="2.4"'),
      ) +
      `</div>`;
    const stages = [...lines.map((line) => ({ at: line.at, reveal: line.baseline + 20 })), { at: cue.totalAt, reveal: length }];
    return {
      html: unit("rp", "", [0, 0], window + slot),
      motion: [...rise(".rp-slot", 0, { distance: 24 }), feed(stages, length), ...roll.motion],
      exit: fadeOut(".rp", duration),
    };
  },
};

module.exports = { receiptPrint };
