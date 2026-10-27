// Created by The Angelo Umali.
// The canvas spring presets as GSAP eases: CustomEase paths sampled from the canvas's own springAt, so a HyperFrames rise
// moves exactly like the canvas one. `sp-<name>` is the travel; `sp-<name>-a` is riseIn's alpha, full by half the travel;
// `sp-<name>-land` stops where the canvas settleTime does (0.99), for countUp, which snaps to its value there.
const { canvasBrand } = require("../brand/canvas");

const SAMPLES = 120;
const SETTLED_WITHIN = 0.002;
const round = (value) => Math.round(value * 1e5) / 1e5;

// Seconds until the spring stays within SETTLED_WITHIN of rest; the tween ends there and lands exactly on 1.
function settleSeconds(preset, springAt) {
  let last = 0;
  for (let t = 0; t <= 6; t += 1 / 240) if (Math.abs(springAt(t, preset) - 1) >= SETTLED_WITHIN) last = t;
  return last + 1 / 240;
}

function easePath(curve) {
  const points = Array.from({ length: SAMPLES + 1 }, (_, index) => `${round(index / SAMPLES)},${round(index === SAMPLES ? 1 : curve(index / SAMPLES))}`);
  return `M${points[0]} L${points.slice(1).join(" ")}`;
}

let table = null;
function springTable() {
  if (table) return table;
  const { scope } = canvasBrand();
  table = Object.fromEntries(
    Object.entries(scope.SPRING).map(([name, preset]) => {
      const duration = settleSeconds(preset, scope.springAt);
      const travel = (progress) => scope.springAt(progress * duration, preset);
      const landing = scope.settleTime(preset);
      const land = easePath((progress) => scope.springAt(progress * landing, preset) / scope.springAt(landing, preset));
      return [name, { duration, landing, travel: easePath(travel), alpha: easePath((progress) => scope.riseAlpha(travel(progress))), land }];
    }),
  );
  return table;
}

// Tween vars for a spring: spread into a `to` block.
const spring = (name = "standard") => ({ ease: `sp-${name}`, duration: springTable()[name].duration });
const springAlpha = (name = "standard") => ({ ease: `sp-${name}-a`, duration: springTable()[name].duration });
// `speed` > 1 plays it faster (a short stat tile counts faster, as the canvas countSpeed does).
const springLanding = (name, speed = 1) => ({ ease: `sp-${name}-land`, duration: springTable()[name].landing / speed });

// The path of every spring ease named in `names` (others are not GSAP eases and are skipped), for the page to register.
function easeDefinitions(names) {
  const paths = Object.fromEntries(
    Object.entries(springTable()).flatMap(([name, { travel, alpha, land }]) => [
      [`sp-${name}`, travel],
      [`sp-${name}-a`, alpha],
      [`sp-${name}-land`, land],
    ]),
  );
  return Object.fromEntries(
    [...new Set(names)]
      .filter((name) => paths[name])
      .sort()
      .map((name) => [name, paths[name]]),
  );
}

module.exports = { spring, springAlpha, springLanding, easeDefinitions };
