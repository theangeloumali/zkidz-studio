// Created by The Angelo Umali.
// phoneScreen (storyboards 10, 14, 17): a real phone, tilted in 3D with a soft shadow, rises in and turns to `tilt` while
// its screen plays the beats he says: a savings ring and tap to pay, coins into SAVE / SPEND jars, a toy swiped out of a cart.
const { num } = require("../../brand/recorder");
const { rise } = require("../../fx/motion");
const { spring } = require("../../fx/springs");
const { LEARNING } = require("../../learning/tokens");
const { fadeOut } = require("./typing");
const { SCREENS, MIN_PT } = require("./phone-screens");

const SCREEN = { w: 390, h: 844, bezel: 14, minPx: 30 };
const TURN = 24; // degrees further round the phone starts before it settles on its tilt
const SHAKE = { swings: [-4, 4, -3, 2, 0], each: 0.06 }; // ±4° over 0.3 s

// A short wiggle with "( )" motion ticks either side of the phone, at `at` (storyboard 17's shake).
function shake(at, w, h) {
  const tick = (x, y, bow) =>
    `<path class="ps-tick" d="M${num(x)} ${num(y)} q ${bow} 18 0 36" fill="none" stroke="${LEARNING.ink}" stroke-width="5" stroke-linecap="round"/>`;
  const marks = [0, 1, 2].map((row) => tick(-12 - row * 4, h * 0.3 + row * 70, -12) + tick(w + 12 + row * 4, h * 0.34 + row * 70, 12)).join("");
  const swings = SHAKE.swings.map((rotation) => ({ rotation, duration: SHAKE.each, ease: "power1.inOut" }));
  const span = SHAKE.swings.length * SHAKE.each;
  return {
    html: `<svg class="ps-ticks" width="${num(w)}" height="${num(h)}" style="position:absolute;left:0;top:0;overflow:visible;opacity:0">${marks}</svg>`,
    motion: [
      { target: ".ps-shake", at, to: { keyframes: [{ rotation: 0, duration: 0 }, ...swings] } },
      {
        target: ".ps-ticks",
        at,
        to: {
          keyframes: [
            { opacity: 1, duration: 0 },
            { opacity: 1, duration: span - 0.1 },
            { opacity: 0, duration: 0.1, ease: "power2.in" },
          ],
        },
      },
    ],
  };
}

function layout(cue) {
  const screen = SCREENS[cue.screen];
  if (!screen) throw new Error(`phoneScreen screen is ${Object.keys(SCREENS).join(", ")}, not ${cue.screen}`);
  const w = cue.w ?? 470;
  const scale = (w - 2 * SCREEN.bezel) / SCREEN.w;
  if (MIN_PT * scale < SCREEN.minPx) throw new Error(`phoneScreen ${cue.screen}: w ${w} sets its ${MIN_PT} pt UI text under ${SCREEN.minPx} px`);
  const beats = [...(cue.beats ?? [])].sort((a, b) => a.at - b.at);
  for (const beat of beats) {
    const fault = screen.check(beat);
    if (fault) throw new Error(`phoneScreen ${cue.screen} beat at ${beat.at}: ${fault}`);
  }
  return { screen, beats, w, scale, h: SCREEN.h * scale + 2 * SCREEN.bezel, x: cue.x ?? 40, y: cue.y ?? 262, tilt: cue.tilt ?? 12 };
}

const phoneScreen = {
  sfx(cue) {
    const { screen, beats } = layout(cue);
    return [{ at: 0, sound: "swish" }, ...screen.sfx(beats)].sort((a, b) => a.at - b.at);
  },
  render(cue, { duration }) {
    const { screen, beats, w, scale, h, x, y, tilt } = layout(cue);
    const { svg, motion, shakeAt } = screen.draw({ cue, beats, duration, seed: cue.seed });
    const [screenW, screenH] = [w - 2 * SCREEN.bezel, h - 2 * SCREEN.bezel];
    const glassRadius = num(w * 0.13);
    const wiggle = shakeAt === undefined ? { html: "", motion: [] } : shake(shakeAt, w, h);
    const html =
      `<div class="box ps" data-scale="${num(scale)}" style="left:${num(x)}px;top:${num(y)}px;width:${num(w)}px;height:${num(h)}px">` +
      `<div class="ps-shake" style="position:absolute;inset:0;transform-origin:50% 60%;perspective:1600px">` +
      `<div class="ps-tilt" style="position:absolute;inset:0;border-radius:${num(w * 0.16)}px;padding:${SCREEN.bezel}px;` +
      `background:linear-gradient(140deg,#3A4250,#0B0F15 40%,#1B222C);box-shadow:${LEARNING.shade.shadow},inset 0 0 0 2px rgba(255,255,255,.12)">` +
      // overflow alone did not clip a swiped card inside the 3D-turned phone; clip-path does.
      `<div class="ps-glass" style="position:relative;width:${num(screenW)}px;height:${num(screenH)}px;border-radius:${glassRadius}px;clip-path:inset(0 round ${glassRadius}px);` +
      `background:linear-gradient(180deg,${LEARNING.shade.card},${LEARNING.shade.screenLow})">` +
      `<svg class="ps-screen" width="${num(screenW)}" height="${num(screenH)}" viewBox="0 0 ${SCREEN.w} ${SCREEN.h}" style="position:absolute;left:0;top:0">${svg}</svg>` +
      `<div style="position:absolute;left:${num(140 * scale)}px;top:${num(14 * scale)}px;width:${num(110 * scale)}px;height:${num(32 * scale)}px;border-radius:${num(16 * scale)}px;background:#0B0F15"></div>` +
      `<div style="position:absolute;inset:0;background:linear-gradient(120deg,rgba(255,255,255,.22),rgba(255,255,255,0) 38%)"></div>` +
      `</div></div></div>${wiggle.html}</div>`;
    const turn = { rotationY: tilt - TURN, rotationX: 4 };
    return {
      html,
      motion: [
        ...rise(".ps", 0, { distance: 90 }),
        { target: ".ps-tilt", at: 0, from: turn, to: { rotationY: tilt, rotationX: 4, ...spring("standard") } },
        ...motion,
        ...wiggle.motion,
      ],
      exit: fadeOut(".ps", duration),
    };
  },
};

module.exports = { phoneScreen };
