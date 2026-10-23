// Created by The Angelo Umali.
// Kinetic type: words rise out of a blur on the canvas stagger, figures roll in like an odometer, an accent gets a gold
// highlighter swipe, and a kicker's tracking settles in.
const { advanceWidth } = require("../brand/fonts");
const { num, escapeXml } = require("../brand/recorder");
const { unit } = require("../brand/html");
const { rise } = require("./motion");
const { spring } = require("./springs");

// Words punch in: up from 2.5x the canvas rise (at least 44 px), down from 125 % and out of a 14 px blur.
const words = (target, at, { step = 0.1, distance = 18, preset = "standard" } = {}) =>
  rise(target, at, { preset, distance: Math.max(44, distance * 2.5), scaleFrom: 1.25, blur: 14, stagger: step });

// A highlighter band growing from its left edge (its unit origin).
const swipe = (target, at, { duration = 0.35 } = {}) => ({ target, at, from: { scaleX: 0 }, to: { scaleX: 1, duration, ease: "power2.out" } });

// Letter spacing in px on a kicker's <text>, wide to settled (the canvas name plate's 0.32 → 0.18 em).
const tracking = (target, at, fromPx, toPx, preset = "standard") => ({
  target,
  at,
  from: { attr: { "letter-spacing": fromPx } },
  to: { attr: { "letter-spacing": toPx }, ...spring(preset) },
});

const DIGIT = /[0-9]/;
// Newsreader's figures span -0.03 to 0.75 em: the window shows one figure and nothing of the card above it.
const ROLL = { line: 1.08, blur: 7, top: 0.78, bottom: 0.05 };

// Each figure of `text` rolls up its own column from 0 and lands on its glyph, right edge at `right` as the canvas count
// is set; the units digit spins twice, the tens once. Separators and signs stand still. Drawn as unit `name`.
function odometer(name, { text, right, baseline, font, colour, at, roll, idPrefix }) {
  const chars = [...text];
  const width = (part) => advanceWidth(part, font);
  const left = right - width(text);
  const lineHeight = font.size * ROLL.line;
  const glyph = (character, x, y) =>
    `<text x="${num(x)}" y="${num(y)}" font-family="${escapeXml(font.family)}" font-size="${num(font.size)}" font-weight="${font.weight}" text-anchor="middle" fill="${colour}">${escapeXml(character)}</text>`;
  const digitsAfter = (index) => chars.slice(index + 1).filter((character) => DIGIT.test(character)).length;
  const stepsOf = (index) => Math.max(0, 2 - digitsAfter(index)) * 10 + Number(chars[index]);
  const filter = `${idPrefix}-roll`;
  let svg = `<defs><filter id="${filter}" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur class="roll-blur" stdDeviation="0 0"/></filter></defs>`;
  chars.forEach((character, index) => {
    const x = left + width(chars.slice(0, index).join("")) + width(character) / 2;
    if (!DIGIT.test(character)) {
      svg += glyph(character, x, baseline);
      return;
    }
    const sequence = Array.from({ length: stepsOf(index) + 1 }, (_, step) => step % 10);
    const clip = `${idPrefix}-col${index}`;
    svg +=
      `<clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><rect x="${num(x - font.size)}" y="${num(baseline - ROLL.top * font.size)}" width="${num(2 * font.size)}" height="${num((ROLL.top + ROLL.bottom) * font.size)}"/></clipPath>` +
      `<g clip-path="url(#${clip})"><g class="roll" data-col="${index}" filter="url(#${filter})">` +
      sequence.map((digit, step) => glyph(digit, x, baseline + step * lineHeight)).join("") +
      `</g></g>`;
  });
  // Every column lands together, as the canvas count does; each travels its own height.
  const motion = chars.flatMap((character, index) =>
    DIGIT.test(character) ? [{ target: `.roll[data-col="${index}"]`, at, from: { y: 0 }, to: { y: -stepsOf(index) * lineHeight, ...roll } }] : [],
  );
  // The figures smear vertically while they spin fastest and come sharp as they land.
  motion.push({ target: ".roll-blur", at, from: { attr: { stdDeviation: `0 ${ROLL.blur}` } }, to: { attr: { stdDeviation: "0 0" }, ...roll } });
  return { html: unit(name, svg), motion };
}

module.exports = { words, swipe, tracking, odometer };
