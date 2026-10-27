// Created by The Angelo Umali.
// Ink & light: strokes draw on along their own path (brand/html.js drawable), a numbered circle floods with ink as its
// row lands, and gold nodes give off a glow ring.

// Dash offset 1.1 → 0 over a path normalised to length 1: the round cap stays hidden until the stroke starts.
const drawOn = (target, at, { duration = 0.3, ease = "power2.inOut", stagger } = {}) => ({
  target,
  at,
  from: { strokeDashoffset: 1.1 },
  to: { strokeDashoffset: 0, duration, ease, ...(stagger ? { stagger } : {}) },
});

// Grows a circular window over `target` from its centre (unit coordinates), so the lit fill spreads like ink in water.
const flood = (target, at, [x, y], radius, { duration = 0.32 } = {}) => ({
  target,
  at,
  from: { clipPath: `circle(0px at ${x}px ${y}px)` },
  to: { clipPath: `circle(${radius}px at ${x}px ${y}px)`, duration, ease: "power2.out" },
});

const GLOW_SECONDS = 0.5;

// One expanding, fading ring around a node that just landed (the woven Z's glow, spec §5.1).
// `repeat` rings again every `duration + repeatDelay` (a gold node that keeps pulsing while its card is up).
const glow = (target, at, { duration = GLOW_SECONDS, scale = 2.4, fromScale = 0.6, fromOpacity = 0.9, repeat = 0, repeatDelay = 1.5 } = {}) => ({
  target,
  at,
  to: {
    keyframes: [
      { scale: fromScale, opacity: fromOpacity, duration: 0 },
      { scale, opacity: 0, duration, ease: "power2.out" },
    ],
    ...(repeat ? { repeat, repeatDelay } : {}),
  },
});

// A pen writing left to right: a page-space window [left, top, right, bottom] opens at the canvas pen's even pace.
const penBox = (left, right, top, bottom) => `polygon(${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px)`;
const penReveal = (target, [start, end], [left, top, right, bottom]) => ({
  target,
  at: start,
  from: { clipPath: penBox(left, left, top, bottom) },
  to: { clipPath: penBox(left, right, top, bottom), duration: end - start, ease: "none" },
});

module.exports = { GLOW_SECONDS, drawOn, flood, glow, penReveal };
