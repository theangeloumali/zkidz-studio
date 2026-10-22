// Created by The Angelo Umali.
// The canvas motion grammar as tween specs ({ target, at, from?, to? }, `at` in seconds after the cue's start): riseIn,
// exitOut and pops on the canvas's own springs. The four effect families (paper, ink, kinetic, impact) build on these.
const { canvasBrand } = require("../brand/canvas");
const { spring, springAlpha } = require("./springs");

const EXIT_SECONDS = canvasBrand().scope.EXIT;
// HyperFrames exits run longer than the canvas's 0.22 s so the way out reads; they still end exactly at cue.stop.
const BOLD_EXIT = 0.4;

// riseIn: travel on the spring, alpha full by half the travel. `blur` lets type come up out of focus (kinetic type).
function rise(target, at, { preset = "standard", distance = 28, scaleFrom = 0.96, blur = 0, stagger } = {}) {
  const each = stagger ? { stagger } : {};
  const scales = scaleFrom !== 1;
  const unblur = blur ? { filter: "blur(0px)", clearProps: "filter" } : {};
  return [
    { target, at, from: { y: distance, ...(scales ? { scale: scaleFrom } : {}) }, to: { y: 0, ...(scales ? { scale: 1 } : {}), ...spring(preset), ...each } },
    { target, at, from: { opacity: 0, ...(blur ? { filter: `blur(${blur}px)` } : {}) }, to: { opacity: 1, ...unblur, ...springAlpha(preset), ...each } },
  ];
}

// The way out, ending exactly at cue.stop: lifted, grown and blurred away over BOLD_EXIT. From explicit values, never
// early: the target may already have risen. `fadeOnly` is the canvas caption fade over EXIT_SECONDS, nothing else.
function exit(target, duration, { fadeOnly = false } = {}) {
  if (fadeOnly) {
    return [
      { target, at: duration - EXIT_SECONDS, from: { opacity: 1 }, to: { opacity: 0, duration: EXIT_SECONDS, ease: "power2.in", immediateRender: false } },
    ];
  }
  return [
    {
      target,
      at: duration - BOLD_EXIT,
      from: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
      to: { opacity: 0, y: -40, scale: 1.06, filter: "blur(10px)", duration: BOLD_EXIT, ease: "power3.in", immediateRender: false },
    },
  ];
}

// A plain fade, for pieces that should not travel (a struck title stepping back to muted).
const fade = (target, at, { from = 0, to = 1, duration = 0.25, ease = "power2.out" } = {}) => ({
  target,
  at,
  from: { opacity: from },
  to: { opacity: to, duration, ease },
});

// Grows from `from` about its origin on a spring (a balloon, a node, a badge).
// `origin` scales an SVG element about its own centre ("50% 50%"); GSAP otherwise uses its top-left.
const pop = (target, at, preset = "snappy", { from = 0, origin, stagger } = {}) => {
  const about = origin ? { transformOrigin: origin } : {};
  return { target, at, from: { scale: from, ...about }, to: { scale: 1, ...about, ...spring(preset), ...(stagger ? { stagger } : {}) } };
};

// Visibility switches at `at` (an arrow's head): near-instant, from explicit values. A hide follows a show on the same
// element, so it must not render early.
const show = (target, at) => ({ target, at, from: { opacity: 0 }, to: { opacity: 1, duration: 0.001, ease: "none" } });
const hide = (target, at) => ({ target, at, from: { opacity: 1 }, to: { opacity: 0, duration: 0.001, ease: "none", immediateRender: false } });

module.exports = { EXIT_SECONDS, BOLD_EXIT, rise, exit, fade, pop, show, hide };
