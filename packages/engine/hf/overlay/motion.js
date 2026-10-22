// Created by The Angelo Umali.
// Brand motion (spec §3): the Remotion spring presets, rise / exit timing and the rising-text helpers built on them.
// Cards, rules and the logo are drawn in brand-draw.js. Enter = rise and fade, not a scale bounce.
const SPRING = {
  heavy: { damping: 42, stiffness: 90 },
  standard: { damping: 18, stiffness: 100 },
  snappy: { damping: 12, stiffness: 120 },
  counter: { damping: 50, stiffness: 100 },
  subtle: { damping: 30, stiffness: 80 },
  elastic: { damping: 8, stiffness: 100 }, // off-brand: censor gag only
};
const EXIT = 0.22;
// Calm boil (spec §4.1): a new drawing every 5 frames at 60 % amplitude.
const BRAND_BOIL_FPS = 6;
const BRAND_JITTER = 0.6;

// Closed-form 0→1 damped spring (mass 1, v0 0): the ODE Remotion's spring() steps per frame.
function springAt(seconds, preset = SPRING.standard) {
  if (seconds <= 0) return 0;
  const natural = Math.sqrt(preset.stiffness);
  const zeta = preset.damping / (2 * natural);
  if (zeta < 1) {
    const damped = natural * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * natural * seconds);
    return 1 - decay * (Math.cos(damped * seconds) + ((zeta * natural) / damped) * Math.sin(damped * seconds));
  }
  if (zeta === 1) return 1 - Math.exp(-natural * seconds) * (1 + natural * seconds);
  const root = Math.sqrt(zeta * zeta - 1);
  const fast = -natural * (zeta + root);
  const slow = -natural * (zeta - root);
  const fastWeight = slow / (fast - slow);
  return 1 + (-1 - fastWeight) * Math.exp(slow * seconds) + fastWeight * Math.exp(fast * seconds);
}

// A rising piece is fully opaque by half its travel.
const riseAlpha = (progress) => clamp(progress / 0.5);

function riseIn(local, start = 0, { preset = SPRING.standard, distance = 28, scaleFrom = 0.96 } = {}) {
  const progress = springAt(local - start, preset);
  return { progress, alpha: riseAlpha(progress), dy: distance * (1 - progress), scale: lerp(scaleFrom, 1, progress) };
}

// Ends exactly at cue.stop, so a cue that stops on an EDL cut is gone by the cut.
function exitOut(env, { seconds = EXIT, distance = 10, scaleTo = 0.985 } = {}) {
  const progress = ease.in(span(env.local, env.duration - seconds, env.duration));
  return { alpha: 1 - progress, dy: -distance * progress, scale: lerp(1, scaleTo, progress) };
}

// `draw` runs in a space whose origin is (x, y), risen by the spring and faded out by the cue exit.
function withMotion(x, y, env, draw, { start = 0, preset, distance, scaleFrom } = {}) {
  const rise = riseIn(env.local, start, { preset, distance, scaleFrom });
  const exit = exitOut(env);
  const alpha = rise.alpha * exit.alpha;
  if (alpha <= 0) return;
  ctx.save();
  ctx.translate(x, y + rise.dy + exit.dy);
  ctx.scale(rise.scale * exit.scale, rise.scale * exit.scale);
  ctx.globalAlpha *= alpha;
  draw();
  ctx.restore();
}

// One risen piece of text: an outline (px) draws it as footage text, otherwise as low-wobble brand ink.
function riseText(text, x, y, font, rise, { color, outline, align = "left" } = {}) {
  if (rise.alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= rise.alpha;
  if (outline) strokedText(text, x, y + rise.dy, font, { fill: color ?? BRAND.paper, outline, align });
  else drawText(text, x, y + rise.dy, { ...font, color: color ?? BRAND.ink, align, wobble: 0.2 });
  ctx.restore();
}

// Per-word rise (TextReveal): each word springs up `distance` px, `step` s after the previous one. Returns the width.
function wordsRise(text, x, y, font, local, start, { step = 0.1, distance = 18, align = "left", color, outline } = {}) {
  const words = text.split(" ");
  const widths = words.map((word) => textWidth(word, font));
  const space = textWidth(" ", font);
  const total = widths.reduce((sum, width) => sum + width, 0) + space * (words.length - 1);
  let wordX = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  words.forEach((word, index) => {
    const rise = riseIn(local, start + index * step, { distance, scaleFrom: 1 });
    riseText(word, wordX, y, font, rise, { color, outline });
    wordX += widths[index] + space;
  });
  return total;
}

// Per-line rise (EditorialHeadlineBlock, 0.333 s per line). Returns the widest line's width.
function linesRise(lines, x, y, font, lineHeight, local, start, { step = 1 / 3, distance = 24, color, outline, align } = {}) {
  lines.forEach((line, index) => {
    const rise = riseIn(local, start + index * step, { distance, scaleFrom: 1 });
    riseText(line, x, y + index * lineHeight, font, rise, { color, outline, align });
  });
  return Math.max(0, ...lines.map((line) => textWidth(line, font)));
}

// The counter spring creeps its last percent for over a second; snapping at 0.99 lands the number with its settle SFX.
function countUp(value, local, start, { preset = SPRING.counter, decimals = 0 } = {}) {
  const progress = springAt(local - start, preset);
  return formatCount(progress >= 0.99 ? value : value * progress, decimals);
}

// Types at `cps`; the cursor is solid while typing, then blinks (on for the first half of each period).
function typeOn(text, local, start, { cps = 20, cursor = "_", blink = 0.5 } = {}) {
  const elapsed = local - start;
  if (elapsed < 0) return "";
  const typed = text.slice(0, Math.floor(elapsed * cps));
  const idle = elapsed - text.length / cps;
  const isCursorOn = idle < 0 || idle % blink < blink / 2;
  return typed + (isCursorOn ? cursor : "");
}

// Starts at max so a settled element does not dip the moment it begins pulsing.
const PULSE = { period: 3, min: 0.7, max: 1 };
const pulse = (local, { period = PULSE.period, min = PULSE.min, max = PULSE.max } = {}) =>
  min + (max - min) * (0.5 + 0.5 * Math.cos((2 * Math.PI * local) / period));
