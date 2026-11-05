// Created by The Angelo Umali.
// flowSteps (storyboard 18): up to three cards joined by arrows, each landing on its pin and then acting out its step:
// chores tick off (check), a coin stack rises (coins), a lock pops open in a gold glow (unlock).
const { unit, drawable } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { rise, fade } = require("../../fx/motion");
const { drawOn } = require("../../fx/ink");
const { LEARNING } = require("../../learning/tokens");
const { microLabel, fadeOut } = require("./typing");
const { coin, coinDefs, toyBricks } = require("./objects");

const { shade: S } = LEARNING;
const CARD = { w: 282, h: 250, gap: 77, radius: 26, act: 0.25 };
const tick = (x, y, s) => `M${num(x + 0.21 * s)} ${num(y + 0.52 * s)} L${num(x + 0.4 * s)} ${num(y + 0.7 * s)} L${num(x + 0.79 * s)} ${num(y + 0.31 * s)}`;

const STEPS = {
  check: {
    sfx: (step) => [0, 1, 2].map((row) => ({ at: step.at + CARD.act + row * 0.18, sound: "check" })),
    draw(step, index) {
      let svg = "";
      const motion = [0, 1, 2].map((row) => {
        const y = 66 + row * 56;
        svg +=
          `<rect x="22" y="${y}" width="38" height="38" rx="10" fill="${LEARNING.accent}"/>` +
          `<rect x="74" y="${y + 13}" width="${150 - row * 24}" height="12" rx="6" fill="${LEARNING.ink}" fill-opacity="0.18"/>` +
          `<g class="fs-check${index}-${row}">${drawable(`<path d="${tick(22, y, 38)}" fill="none" stroke="${LEARNING.ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`)}</g>`;
        return drawOn(`.fs-check${index}-${row} path`, step.at + CARD.act + row * 0.18, { duration: 0.18 });
      });
      return { svg, motion };
    },
  },
  coins: {
    sfx: (step) => [{ at: step.at + CARD.act, sound: "count", dur: 0.6 }],
    draw(step, index, seed) {
      let svg = `<defs>${coinDefs(seed)}</defs>`;
      const motion = Array.from({ length: 6 }, (_, k) => {
        svg += `<g class="fs-coin${index}-${k}" opacity="0">${coin(seed, 110, 210 - k * 17, 52, 0.38)}</g>`;
        return {
          target: `.fs-coin${index}-${k}`,
          at: step.at + CARD.act + k * 0.08,
          from: { y: -50, opacity: 0 },
          to: { y: 0, opacity: 1, duration: 0.22, ease: "power2.in" },
        };
      });
      svg += `<g class="fs-up${index}">${drawable(`<path d="M232 190 V110 M214 130 L232 110 L250 130" fill="none" stroke="${LEARNING.accentInk}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`)}</g>`;
      motion.push(drawOn(`.fs-up${index} path`, step.at + CARD.act + 0.5, { duration: 0.3 }));
      return { svg, motion };
    },
  },
  unlock: {
    sfx: (step) => [{ at: step.at + CARD.act + 0.1, sound: "nodeGold" }],
    draw(step, index) {
      const at = step.at + CARD.act + 0.1;
      const svg =
        `<rect x="56" y="62" width="170" height="170" rx="22" fill="${S.card}"/>` +
        toyBricks(81, 87, 120) +
        `<g class="fs-shackle${index}"><path d="M216 112 V96 a17 17 0 0 1 34 0 V112" fill="none" stroke="${LEARNING.ink}" stroke-width="8" stroke-linecap="round"/></g>` +
        `<rect x="206" y="110" width="54" height="42" rx="9" fill="${LEARNING.accent}"/><circle cx="233" cy="130" r="6" fill="${LEARNING.ink}"/>`;
      return {
        svg,
        motion: [
          {
            target: `.fs-shackle${index}`,
            at,
            from: { rotation: 0, y: 0, svgOrigin: "250 112" },
            to: { rotation: 28, y: -10, svgOrigin: "250 112", duration: 0.3, ease: "back.out(2)" },
          },
          fade(`.fs-glow${index}`, at, { duration: 0.35 }),
        ],
      };
    },
  },
};

function layout(cue) {
  const steps = cue.steps ?? [];
  if (steps.length > 3) throw new Error(`flowSteps "${steps.map((step) => step.label).join(" → ")}": three steps fit the frame, not ${steps.length}`);
  for (const step of steps)
    if (!STEPS[step.kind]) throw new Error(`flowSteps step "${step.label}": kind is ${Object.keys(STEPS).join(", ")}, not ${step.kind}`);
  const total = steps.length * CARD.w + (steps.length - 1) * CARD.gap;
  const left = (cue.x ?? 540) - total / 2;
  return steps.map((step, index) => ({ ...step, left: left + index * (CARD.w + CARD.gap), top: cue.y ?? 380 }));
}

const flowSteps = {
  sfx: (cue) =>
    layout(cue)
      .flatMap((step) => [{ at: step.at, sound: "tick" }, ...STEPS[step.kind].sfx(step)])
      .sort((a, b) => a.at - b.at),
  render(cue, { duration }) {
    const steps = layout(cue);
    const motion = [];
    const cards = steps.map((step, index) => {
      const act = STEPS[step.kind].draw(step, index, cue.seed);
      motion.push(...rise(`.fs-card${index}`, step.at, { distance: 40 }), ...act.motion);
      const label = microLabel(step.label, 22, 40);
      const glowRing =
        step.kind === "unlock"
          ? `<div class="fs-glow${index}" style="position:absolute;inset:0;border-radius:${CARD.radius}px;opacity:0;box-shadow:0 0 0 4px ${LEARNING.accent},0 0 60px rgba(201,168,56,.7)"></div>`
          : "";
      return (
        `<div class="box fs-card${index}" style="left:${num(step.left)}px;top:${num(step.top)}px;width:${CARD.w}px;height:${CARD.h}px;border-radius:${CARD.radius}px;` +
        `background:rgba(251,248,242,.96);box-shadow:${LEARNING.shade.shadow}">${glowRing}${unit(`fs-art${index}`, label + act.svg)}</div>`
      );
    });
    const arrows = steps.slice(1).map((step, index) => {
      const x = steps[index].left + CARD.w + 14;
      const y = step.top + CARD.h / 2;
      motion.push(drawOn(`.fs-arrow${index} path`, Math.max(0, step.at - 0.2), { duration: 0.2 }));
      const d = `M${num(x)} ${num(y)} H${num(x + 46)} M${num(x + 34)} ${num(y - 12)} L${num(x + 46)} ${num(y)} L${num(x + 34)} ${num(y + 12)}`;
      return unit(
        `fs-arrow${index}`,
        drawable(`<path d="${d}" fill="none" stroke="${LEARNING.ink}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`),
      );
    });
    return { html: unit("fs", "", [0, 0], cards.join("") + arrows.join("")), motion, exit: fadeOut(".fs", duration) };
  },
};

module.exports = { flowSteps };
