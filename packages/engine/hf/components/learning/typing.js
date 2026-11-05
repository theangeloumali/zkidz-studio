// Created by The Angelo Umali.
// Shared by the learning UI kinds (ui.js, cta.js, receipt.js): SVG text, the mono micro-label, the exit fade, and the
// typing tracks. Every track is one keyframes tween from explicit values, so any frame seeks clean.
const { num, escapeXml } = require("../../brand/recorder");
const { LEARNING } = require("../../learning/tokens");

const { prompt: T, micro: MICRO } = LEARNING;
const MONO = LEARNING.type.mono;

const glyph = (text, x, y, font, colour, extra = "") =>
  `<text x="${num(x)}" y="${num(y)}" font-family="${escapeXml(font.family)}" font-weight="${font.weight}" font-size="${num(font.size)}" ` +
  `fill="${colour}"${extra} style="white-space:pre">${escapeXml(text)}</text>`;

const microLabel = (text, x, y, colour = LEARNING.ink) =>
  glyph(text.toUpperCase(), x, y, { ...MONO, size: MICRO.size }, colour, ` fill-opacity="${MICRO.opacity}" letter-spacing="${MICRO.tracking}"`);

const fadeOut = (target, duration) => [
  {
    target,
    at: Math.max(0, duration - LEARNING.exit),
    from: { opacity: 1 },
    to: { opacity: 0, duration: LEARNING.exit, ease: "power2.in", immediateRender: false },
  },
];

// One keyframes track on `target`: `first` from `at`, then each [time, props] switches in exactly on its time.
function track(target, at, first, switches) {
  let last = at;
  const frames = switches.map(([time, props]) => {
    const frame = { ...props, duration: time - last, ease: "steps(1)" };
    last = time;
    return frame;
  });
  return { target, at, to: { keyframes: [{ ...first, duration: 0 }, ...frames] } };
}

// One keyframes track from 0: holds `first`, then on each [time, props] glides to props over `glide`; a pin that lands
// mid-glide waits for it. `vars` ride along (an SVG origin).
function glideTrack(target, first, pins, { glide = 0.6, ease = "power2.out", ...vars } = {}) {
  const frames = [{ ...first, duration: 0 }];
  let [clock, held] = [0, first];
  for (const [time, props] of pins) {
    const at = Math.max(time, clock);
    frames.push({ ...held, duration: at - clock, ease: "none" }, { ...props, duration: glide, ease });
    [clock, held] = [at + glide, props];
  }
  return { target, at: 0, to: { keyframes: frames, ...vars } };
}

// A CSS clip-path rectangle in frame pixels.
const rectClip = (left, top, right, bottom) =>
  `polygon(${num(left)}px ${num(top)}px, ${num(right)}px ${num(top)}px, ${num(right)}px ${num(bottom)}px, ${num(left)}px ${num(bottom)}px)`;

// A line typed letter by letter: `xs[k]` is its right edge after k letters, one letter every `step` seconds.
function reveal(target, at, step, xs, [top, bottom]) {
  const clip = (right) => rectClip(xs[0], top, right, bottom);
  return track(
    target,
    at,
    { opacity: 1, clipPath: clip(xs[0]) },
    xs.slice(1).map((x, index) => [at + (index + 1) * step, { clipPath: clip(x) }]),
  );
}

// A cursor on for the first half of every blink, solid over `solid`, gone from `hideAt`.
function blink(target, [solidFrom, solidTo], hideAt) {
  const half = T.blink / 2;
  const state = (t) => (t >= hideAt ? 0 : t >= solidFrom && t < solidTo ? 1 : Math.floor(t / half + 1e-9) % 2 === 0 ? 1 : 0);
  const edges = Array.from({ length: Math.ceil(hideAt / half) }, (_, index) => (index + 1) * half);
  const times = [...new Set([...edges, solidFrom, solidTo, hideAt].filter((t) => t > 0 && t <= hideAt))].sort((a, b) => a - b);
  let shown = 1;
  const switches = times.flatMap((t) => (state(t) === shown ? [] : [[t, { opacity: (shown = state(t)) }]]));
  return track(target, 0, { opacity: 1 }, switches);
}

// How fast to type `count` letters from `at` and land by `end`: `cps`, or faster when the pin is late; refused when too late.
function typingStep(kind, text, count, at, end, endName, cps) {
  if (!count) return 0;
  if (at >= end) throw new Error(`${kind} "${text}": typeAt ${at} leaves no time to type before ${endName} ${num(end)}`);
  return Math.min(1 / cps, (end - at) / count);
}

// Greedy word wrap on fixed mono columns; a word longer than a line breaks across lines.
function wrapColumns(text, columns) {
  const lines = [""];
  for (let word of text.split(" ")) {
    while (word.length > columns) {
      if (lines.at(-1)) lines.push("");
      lines[lines.length - 1] = word.slice(0, columns);
      lines.push("");
      word = word.slice(columns);
    }
    const joined = lines.at(-1) ? `${lines.at(-1)} ${word}` : word;
    if (joined.length <= columns) lines[lines.length - 1] = joined;
    else lines.push(word);
  }
  return lines;
}

// The fills bars and plates take, and the text colour of a row in that tone (gold is too light for text). An unknown
// tone (the retired "rust" too) stops the build naming `owner`.
const TEXT = { ink: LEARNING.ink, accent: LEARNING.accentInk };
function toneOf(table, tone, owner) {
  if (!Object.hasOwn(table, tone)) throw new Error(`${owner}: tone is ${Object.keys(table).join(" or ")}, not ${tone}`);
  return table[tone];
}
const textFill = (tone, owner) => toneOf(TEXT, tone, owner);

module.exports = { rectClip, glyph, microLabel, fadeOut, track, glideTrack, reveal, blink, typingStep, wrapColumns, textFill };
