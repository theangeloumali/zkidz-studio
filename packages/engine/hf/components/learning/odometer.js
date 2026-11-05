// Created by The Angelo Umali.
// The odometer strips bigWord and receiptPrint roll: one column of digits per place, each value's row in it.
const { num } = require("../../brand/recorder");
const { glyph } = require("./typing");

const MAX_ROWS = 30;

// Each odometer column over `values` (the figure times 10^decimals), most significant first: its strip's digits and each
// value's row. Places above `pad` integer digits are blank while zero. A column whose range passes MAX_ROWS keeps, per
// roll, only the last rows before its step's digit, so every step still lands on its own digit (the jump hides in the blur).
function odometerColumns(values, { decimals = 0, pad = 1 } = {}) {
  if (values.some((value) => value < 0)) throw new Error(`bigWord counts are never negative: ${values.join(" → ")}`);
  const places = Math.max(String(Math.max(...values)).length, decimals + pad);
  return Array.from({ length: places }, (_, index) => {
    const place = places - 1 - index;
    const steps = values.map((value) => Math.floor(value / 10 ** place));
    const [low, high] = [Math.min(...steps), Math.max(...steps)];
    const digitOf = (step) => (step === 0 && place >= decimals + pad ? "" : String(step % 10));
    if (high - low < MAX_ROWS) return { digits: Array.from({ length: high - low + 1 }, (_, row) => digitOf(low + row)), rows: steps.map((step) => step - low) };
    const budget = Math.max(1, Math.floor((MAX_ROWS - 1) / Math.max(1, steps.length - 1)));
    const digits = [digitOf(steps[0])];
    const rows = [0];
    steps.slice(1).forEach((to, roll) => {
      const from = steps[roll];
      const span = Math.abs(to - from);
      for (let row = Math.max(1, span - budget + 1); row <= span; row += 1) digits.push(digitOf(from + Math.sign(to - from) * row));
      rows.push(digits.length - 1);
    });
    return { digits, rows };
  });
}

// One column's strip, clipped to its cell [left, top, width, height]: its digits a `line` apart, the first value's row on
// `baseline`. `group` holds the rolling <g>'s attributes (its class, a blur filter).
function odometerStrip(clip, { digits, rows }, [left, top, width, height], { baseline, line, font, colour, group }) {
  const centre = left + width / 2;
  return (
    `<clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><rect x="${num(left)}" y="${num(top)}" width="${num(width)}" height="${num(height)}"/></clipPath>` +
    `<g clip-path="url(#${clip})"><g ${group}>` +
    digits.map((digit, row) => (digit ? glyph(digit, centre, baseline + (row - rows[0]) * line, font, colour, ' text-anchor="middle"') : "")).join("") +
    `</g></g>`
  );
}

module.exports = { odometerColumns, odometerStrip };
