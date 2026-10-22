// Created by The Angelo Umali.
// Impact beats: a stamp slams in from 2.6x with motion blur and lands with a decaying shake; ink droplets or gold specks
// burst from a hit; the censor pops on the elastic spring and buzzes. Every random value comes from the cue's seed.
const { canvasBrand } = require("../brand/canvas");
const { unit } = require("../brand/html");

const random = (seed) => canvasBrand().scope.mulberry32(seed * 7919 + 104729);

// Scale and blur down to contact on an accelerating ease; visible within 0.06 s, as the canvas stamp.
const slam = (target, at, contact, { from = 2.6, blur = 10 } = {}) => [
  {
    target,
    at,
    from: { scale: from, filter: `blur(${blur}px)` },
    to: { scale: 1, filter: "blur(0px)", clearProps: "filter", duration: contact, ease: "power2.in" },
  },
  { target, at, from: { opacity: 0 }, to: { opacity: 1, duration: 0.06, ease: "none" } },
];

// A decaying jolt in seeded directions: `amplitude` px at contact, near still after `duration`.
function shake(target, at, seed, { amplitude = 10, duration = 0.42, steps = 9 } = {}) {
  const rand = random(seed);
  const keyframes = Array.from({ length: steps }, (_, step) => {
    const decay = Math.exp((-4 * step) / steps);
    const angle = rand() * Math.PI * 2;
    return { x: Math.cos(angle) * amplitude * decay, y: Math.sin(angle) * amplitude * decay, duration: duration / (steps + 1), ease: "sine.inOut" };
  });
  keyframes.push({ x: 0, y: 0, duration: duration / (steps + 1), ease: "sine.out" });
  return { target, at, to: { keyframes } };
}

// The canvas stamp's settle after contact (stampSettle), sampled as scale keyframes.
function wobble(target, at, { duration = 0.5, steps = 15 } = {}) {
  const { stampSettle } = canvasBrand().scope;
  const keyframes = Array.from({ length: steps }, (_, step) => ({
    scale: stampSettle(((step + 1) * duration) / steps),
    duration: duration / steps,
    ease: "none",
  }));
  return { target, at, to: { keyframes } };
}

// The canvas censor's shake (CENSOR_SHAKE) for `duration`: x swings ±amplitude, a half swing every pi / rate seconds.
function buzz(target, at, duration) {
  const { amplitude, rate } = canvasBrand().scope.CENSOR_SHAKE;
  const half = Math.PI / rate;
  return {
    target,
    at,
    from: { x: -amplitude },
    to: { x: amplitude, duration: half, ease: "sine.inOut", yoyo: true, repeat: Math.max(1, Math.ceil(duration / half)) },
  };
}

// Seeded particles drawn by the canvas sketch, flung out from `centre` at `at` and fading. Hidden (.pre) until thrown, so
// the keyframes start from CSS rather than a from-state that would show early.
function burst(className, seed, [cx, cy], at, { count = 10, colour, reach = [70, 160], size = [5, 11], idPrefix, spread = [0, Math.PI * 2] }) {
  const rand = random(seed + 31);
  const { svg } = canvasBrand();
  const particles = Array.from({ length: count }, (_, index) => {
    const angle = spread[0] + (spread[1] - spread[0]) * ((index + rand() * 0.8) / count);
    const distance = reach[0] + (reach[1] - reach[0]) * rand();
    const radius = size[0] + (size[1] - size[0]) * rand();
    return { dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance, radius, delay: rand() * 0.05, life: 0.45 + rand() * 0.2 };
  });
  return {
    html: particles
      .map(({ radius }, index) =>
        unit(
          `${className} p${index} pre`,
          svg(seed + index, `${idPrefix}-p${index}`, (k) => k.sketchEllipse(cx, cy, radius, radius, { fill: colour, stroke: false })),
          [cx, cy],
        ),
      )
      .join(""),
    motion: particles.map(({ dx, dy, delay, life }, index) => ({
      target: `.${className}.p${index}`,
      at: at + delay,
      to: {
        keyframes: [
          { x: 0, y: 0, scale: 0.4, opacity: 1, duration: 0 },
          { x: dx, y: dy, scale: 1, opacity: 0, duration: life, ease: "power3.out" },
        ],
      },
    })),
  };
}

module.exports = { slam, shake, wobble, buzz, burst };
