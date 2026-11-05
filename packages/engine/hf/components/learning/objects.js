// Created by The Angelo Umali.
// Drawn objects the live kinds share (#20): a gold coin seen from above, a dimensional column, toy bricks. SVG fragments in
// the caller's coordinates; gradient ids carry the cue seed, since every cue on a page shares one document.
const { num } = require("../../brand/recorder");
const { LEARNING } = require("../../learning/tokens");

const { shade: S } = LEARNING;

const coinDefs = (seed) =>
  `<radialGradient id="s${seed}-coin" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="${S.goldLight}"/>` +
  `<stop offset=".55" stop-color="${LEARNING.accent}"/><stop offset="1" stop-color="${S.goldSide}"/></radialGradient>`;

// `tilt` squashes the face as the coin turns towards the eye.
function coin(seed, cx, cy, r, tilt = 0.42) {
  const ry = r * tilt;
  return (
    `<ellipse cx="${num(cx)}" cy="${num(cy + r * 0.16)}" rx="${num(r)}" ry="${num(ry)}" fill="${S.coinEdge}"/>` +
    `<rect x="${num(cx - r)}" y="${num(cy)}" width="${num(2 * r)}" height="${num(r * 0.16)}" fill="${S.coinEdge}"/>` +
    `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(r)}" ry="${num(ry)}" fill="url(#s${seed}-coin)"/>` +
    `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(r * 0.72)}" ry="${num(ry * 0.72)}" fill="none" stroke="${S.goldSide}" stroke-width="${num(r * 0.07)}"/>` +
    `<ellipse cx="${num(cx - r * 0.25)}" cy="${num(cy - ry * 0.3)}" rx="${num(r * 0.32)}" ry="${num(ry * 0.22)}" fill="#FFFFFF" fill-opacity="0.45"/>`
  );
}

// A level with a front, a lit top and a shaded side; `face` adds attributes to the front <rect> (stepBars keeps its class).
const TONES = { ink: [LEARNING.ink, S.inkTop, S.inkSide], accent: [LEARNING.accent, S.goldTop, S.goldSide] };
function assertTone(tone, owner) {
  if (!Object.hasOwn(TONES, tone)) throw new Error(`${owner}: tone is ${Object.keys(TONES).join(" or ")}, not ${tone}`);
}
function column(x, base, w, h, tone, face = "") {
  const [front, top, side] = TONES[tone];
  const d = w * 0.32;
  const [up, back] = [base - h, d * 0.6];
  return (
    `<rect${face} x="${num(x)}" y="${num(up)}" width="${num(w)}" height="${num(h)}" fill="${front}"/>` +
    `<polygon class="bar-top" points="${num(x)},${num(up)} ${num(x + d)},${num(up - back)} ${num(x + w + d)},${num(up - back)} ${num(x + w)},${num(up)}" fill="${top}"/>` +
    `<polygon class="bar-side" points="${num(x + w)},${num(base)} ${num(x + w + d)},${num(base - back)} ${num(x + w + d)},${num(up - back)} ${num(x + w)},${num(up)}" fill="${side}"/>`
  );
}

// Three toy bricks on a 120-unit square at [x, y], `size` px wide: dimensional blocks, not a pictogram.
function toyBricks(x, y, size) {
  const brick = (bx, by, w, fill) =>
    [bx + 6, bx + w - 18].map((stud) => `<rect x="${stud}" y="${by - 7}" width="12" height="9" rx="2" fill="${fill}"/>`).join("") +
    `<rect x="${bx}" y="${by}" width="${w}" height="36" rx="5" fill="${fill}"/>` +
    `<rect x="${bx}" y="${by + 26}" width="${w}" height="10" rx="4" fill="#000000" fill-opacity="0.18"/>`;
  return (
    `<g transform="translate(${num(x)} ${num(y)}) scale(${num(size / 120)})">` +
    brick(14, 70, 44, LEARNING.ink) +
    brick(62, 70, 44, LEARNING.accentInk) +
    brick(36, 32, 48, LEARNING.accent) +
    `</g>`
  );
}

module.exports = { coin, coinDefs, column, assertTone, toyBricks };
