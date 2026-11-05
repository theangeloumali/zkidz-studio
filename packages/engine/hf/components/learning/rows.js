// Created by The Angelo Umali.
// listRows: big rows on paper that slide in on their pins, each with an optional accent check or cross drawing on after it —
// the careers he lists, the steps he names. `card: true` sets each row on a white card with a gold check disc and an optional
// right-aligned mono `note` (storyboard 11).
const { unit } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { LEARNING } = require("../../learning/tokens");
const { glyph, fadeOut, textFill } = require("./typing");
const { penReveal } = require("../../fx/ink");
const { pop } = require("../../fx/motion");

const { rows: R } = LEARNING;
const CARD = { height: 1.97, disc: 1.1, pad: 0.53, gap: 0.47, note: 24 }; // in em of the row text
const MARKS = {
  check: (x, y, s) => `M${num(x + 0.08 * s)} ${num(y + 0.55 * s)} L${num(x + 0.4 * s)} ${num(y + 0.86 * s)} L${num(x + 0.94 * s)} ${num(y + 0.14 * s)}`,
  cross: (x, y, s) =>
    `M${num(x + 0.12 * s)} ${num(y + 0.12 * s)} L${num(x + 0.88 * s)} ${num(y + 0.88 * s)} M${num(x + 0.88 * s)} ${num(y + 0.12 * s)} L${num(x + 0.12 * s)} ${num(y + 0.88 * s)}`,
};

function layout(cue) {
  const font = { ...LEARNING.type.display, size: cue.size ?? R.size };
  const [x, y, gap] = [cue.x ?? R.x, cue.y ?? R.y, cue.gap ?? R.gap];
  return cue.rows.map((row, index) => {
    if (row.mark && !MARKS[row.mark]) throw new Error(`listRows row "${row.text}": mark is ${Object.keys(MARKS).join(" or ")}, not ${row.mark}`);
    const tone = row.tone ?? "ink";
    // The mark keeps its proportion to the row text at any size.
    const mark = (R.markSize * font.size) / R.size;
    const width = cue.cardWidth ?? 1080 - 2 * x;
    const note = cue.card && row.note ? row.note.toUpperCase() : "";
    const noteRoom = note ? advanceWidth(note, { ...LEARNING.type.mono, weight: 600, size: CARD.note }) + 40 + CARD.pad * font.size : 0;
    const textX = cue.card ? x + (CARD.pad + CARD.disc + CARD.gap) * font.size : x + (row.mark ? mark + (R.markGap * font.size) / R.size : 0);
    const right = cue.card ? x + width - noteRoom : 1080 - LEARNING.big.side;
    if (textX + advanceWidth(row.text, font) > right) throw new Error(`listRows row "${row.text}" runs past the frame at size ${font.size}`);
    return {
      ...row,
      font,
      x,
      textX,
      markSize: mark,
      width,
      note,
      baseline: y + index * gap,
      fill: textFill(tone, `listRows row "${row.text}"`),
      at: Math.max(0, row.at ?? index * 0.4),
    };
  });
}

const listRows = {
  sfx: (cue) => layout(cue).map((row) => (row.mark ? { at: row.at + R.markDelay, sound: "check" } : { at: row.at, sound: "tick" })),
  render(cue, { duration }) {
    const parts = layout(cue).map((row, index) => (cue.card ? cardRow(row, index) : bareRow(row, index)));
    return {
      html: unit("rows", "", [0, 0], parts.map((part) => part.html).join("")),
      motion: parts.flatMap((part) => part.motion),
      exit: fadeOut(".rows", duration),
    };
  },
};

// A row's mark as its own unit, empty when the row has none: `shape` is its SVG at the row's size.
const markUnit = (row, index, shape, origin) => (row.mark ? unit(`mark mark${index}`, shape, origin) : "");

const slideIn = (row, index) => ({
  target: `.row${index}`,
  at: row.at,
  from: { x: -R.slide, opacity: 0 },
  to: { x: 0, opacity: 1, duration: R.slideDur, ease: "power3.out" },
});

// A white card: the gold disc pops its ink check in after the row lands, the note sits right in mono.
function cardRow(row, index) {
  const size = row.font.size;
  const [height, middle] = [CARD.height * size, row.baseline - 0.35 * size];
  const disc = CARD.disc * size;
  const [cx, right] = [row.x + (CARD.pad + CARD.disc / 2) * size, row.x + row.width - CARD.pad * size];
  const card = `<rect class="row-card" x="${num(row.x)}" y="${num(middle - height / 2)}" width="${num(row.width)}" height="${num(height)}" rx="${num(0.43 * size)}" fill="#FFFFFF" style="filter:drop-shadow(0 16px 17px rgba(23,34,48,.12))"/>`;
  const note = row.note
    ? glyph(
        row.note,
        right,
        middle + 0.36 * CARD.note,
        { ...LEARNING.type.mono, weight: 600, size: CARD.note },
        LEARNING.ink,
        ' text-anchor="end" fill-opacity="0.55" letter-spacing="3"',
      )
    : "";
  const check = row.mark ? MARKS[row.mark](cx - disc * 0.26, middle - disc * 0.26, disc * 0.52) : "";
  const mark = markUnit(
    row,
    index,
    `<circle class="row-disc" cx="${num(cx)}" cy="${num(middle)}" r="${num(disc / 2)}" fill="${LEARNING.accent}"/>` +
      `<path d="${check}" stroke="${LEARNING.ink}" stroke-width="${num(disc * 0.07)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    [cx, middle],
  );
  return {
    html: unit(`row row${index}`, card + glyph(row.text, row.textX, row.baseline, row.font, row.fill) + note, [row.textX, row.baseline], mark),
    motion: [slideIn(row, index), ...(row.mark ? [pop(`.mark${index}`, row.at + R.markDelay, "snappy")] : [])],
  };
}

function bareRow(row, index) {
  const size = row.markSize;
  const top = row.baseline - 0.78 * size;
  const mark = markUnit(
    row,
    index,
    row.mark
      ? `<path d="${MARKS[row.mark](row.x, top, size)}" stroke="${LEARNING.accent}" stroke-width="${num(size * 0.16)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
      : "",
  );
  const [left, right, low, high] = [row.x - 10, row.x + size + 10, top - 10, top + size + 10];
  return {
    html: unit(`row row${index}`, glyph(row.text, row.textX, row.baseline, row.font, row.fill), [row.textX, row.baseline]) + mark,
    motion: [
      slideIn(row, index),
      ...(row.mark
        ? [penReveal(`.mark${index}`, [row.at + R.markDelay, row.at + R.markDelay + R.markDur], [left, low, right, high], { ease: "power2.out" })]
        : []),
    ],
  };
}

module.exports = { listRows };
