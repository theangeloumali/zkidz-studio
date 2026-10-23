// Created by The Angelo Umali.
// Paper physics. A card flies, drops or swings in from off-screen over ~0.9 s, lands on a springy ease and holds still
// (a drifting card distracts); it whips out over BOLD_EXIT. Small cards inside a card (flow boxes) keep the
// short lift. Rows slide in with a skew that straightens.
const { BOLD_EXIT } = require("./motion");
const { spring, springAlpha } = require("./springs");

const PERSPECTIVE = { transformPerspective: 1200 };
const ENTER = 0.9;
// Off-screen start and away pose per style; `origin` is the hinge. Positions are relative to the card's own place.
const STYLES = {
  flyLeft: { enter: (x, y, w) => ({ x: -(x + w + 80), rotationY: 40, rotationZ: -8, scale: 0.85 }), leave: () => ({ x: 1150, rotationY: -35, rotationZ: 7 }) },
  flyRight: { enter: (x) => ({ x: 1080 - x + 80, rotationY: -40, rotationZ: 8, scale: 0.85 }), leave: () => ({ x: 1150, rotationY: -35, rotationZ: 7 }) },
  drop: {
    enter: (x, y, w, h) => ({ y: -(y + h + 140), rotationX: -65, rotationZ: 4, scale: 0.9 }),
    leave: (x, y, w, h) => ({ y: -(y + h + 160), rotationX: 50 }),
  },
  swing: { origin: "0% 50%", enter: () => ({ rotationY: -100 }), leave: () => ({ rotationY: 95 }) },
};
const SEEDED = ["flyLeft", "drop", "swing"];
// The same seed gives the same style, so a card's way in and way out always match.
const styleOf = (cue, style) => style ?? SEEDED[cue.seed % SEEDED.length];
const REST = { x: 0, y: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1 };

// `target` is a .box holding a .shadow unit; [x, y, w, h] is where the card rests.
function cardIn(target, at, style, [x, y, w, h]) {
  const pose = STYLES[style];
  const origin = pose.origin ? { transformOrigin: pose.origin } : {};
  return [
    {
      target,
      at,
      from: { ...pose.enter(x, y, w, h), ...origin, ...PERSPECTIVE },
      to: { ...REST, ...origin, ...PERSPECTIVE, duration: ENTER, ease: "back.out(1.4)" },
    },
    { target, at, from: { opacity: 0 }, to: { opacity: 1, duration: 0.25, ease: "power1.out" } },
    { target, at, from: { filter: "blur(16px)" }, to: { filter: "blur(0px)", clearProps: "filter", duration: 0.6, ease: "power2.out" } },
    // The shadow trails the card and settles under it at dropShadow's offset.
    { target: `${target} > .shadow`, at, from: { x: 30, y: 60, opacity: 0 }, to: { x: 0, y: 0, opacity: 1, duration: ENTER + 0.15, ease: "power2.out" } },
  ];
}

// Over the cue's last BOLD_EXIT seconds; from explicit values because the entrance already owns these properties.
function cardOut(target, duration, style, [x, y, w, h]) {
  const pose = STYLES[style];
  const origin = pose.origin ? { transformOrigin: pose.origin } : {};
  const at = duration - BOLD_EXIT;
  return [
    {
      target,
      at,
      from: { ...REST, opacity: 1, filter: "blur(0px)", ...origin, ...PERSPECTIVE },
      to: {
        ...pose.leave(x, y, w, h),
        opacity: 0,
        filter: "blur(14px)",
        ...origin,
        ...PERSPECTIVE,
        duration: BOLD_EXIT,
        ease: "power3.in",
        immediateRender: false,
      },
    },
  ];
}

// The short lift for a card inside a card: up from 60 px below, tilted back 16°, out of a blur.
function cardLift(target, at, { preset = "standard" } = {}) {
  return [
    { target, at, from: { y: 60, scale: 0.96, ...PERSPECTIVE }, to: { y: 0, scale: 1, ...PERSPECTIVE, ...spring(preset) } },
    { target, at, from: { rotationX: 16 }, to: { rotationX: 0, ...spring("snappy") } },
    { target, at, from: { opacity: 0, filter: "blur(6px)" }, to: { opacity: 1, filter: "blur(0px)", clearProps: "filter", ...springAlpha(preset) } },
  ];
}

function slideIn(target, at, { preset = "standard", distance = 32, skew = -10 } = {}) {
  return [
    { target, at, from: { x: -distance, skewX: skew }, to: { x: 0, skewX: 0, ...spring(preset) } },
    { target, at, from: { opacity: 0 }, to: { opacity: 1, ...springAlpha(preset) } },
  ];
}

module.exports = { styleOf, cardIn, cardOut, cardLift, slideIn };
