// Created by The Angelo Umali.
// phoneScreen's three screens (storyboards 10, 14, 17), drawn on a 390x844 pt screen. Each checks its beats, draws its
// SVG and its motion, and names its sounds. Every UI text is at least MIN_PT, which phone.js keeps at 30 px or more.
const { num } = require("../../brand/recorder");
const { glow } = require("../../fx/ink");
const { show, hide, pop } = require("../../fx/motion");
const { LEARNING } = require("../../learning/tokens");
const { glyph, glideTrack } = require("./typing");
const { coin, coinDefs, toyBricks } = require("./objects");

const { shade: S, ink: INK } = LEARNING;
const MIN_PT = 27;
const UI = (size, weight = 700) => ({ ...LEARNING.type.ui, weight, size });
const title = (text) => glyph(text, 30, 124, UI(46));
const RING = { cx: 195, cy: 310, r: 118, fill: 0.6 };

// Each beat's [pin, { key: value }] for glideTrack.
const keyed = (key, beats, valueOf) => beats.map((beat, index) => [beat.at, { [key]: valueOf(beat, index) }]);

const savings = {
  check: (beat) => (beat.pay === true || (beat.fill >= 0 && beat.fill <= 1) ? null : "fill is a share in [0, 1] or pay is true"),
  sfx: (beats) => beats.map((beat) => ({ at: beat.at, sound: beat.pay ? "nodeGold" : "tick" })),
  draw({ beats, duration, seed }) {
    const fills = beats.filter((beat) => !beat.pay);
    const pays = beats.filter((beat) => beat.pay);
    const { cx, cy, r } = RING;
    const ring = 2 * Math.PI * r;
    const bars = [0.4, 0.55, 0.5, 0.72, 0.95].map(
      (height, index) =>
        `<rect class="ps-bar${index}" x="${34 + index * 68}" y="${num(610 - height * 120)}" width="50" height="${num(height * 120)}" rx="10" fill="${index === 4 ? LEARNING.accent : INK}" fill-opacity="${index === 4 ? 1 : 0.85}"/>`,
    );
    const svg =
      title("Savings") +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-opacity="0.1" stroke-width="34"/>` +
      // Dashes in px of the ring's own length: a pathLength-scaled offset drew the ring full in Chrome.
      `<path class="ps-ring" d="M${cx} ${cy - r} a${r} ${r} 0 1 1 0 ${2 * r} a${r} ${r} 0 1 1 0 ${-2 * r}" fill="none" stroke="${LEARNING.accent}" stroke-width="34" stroke-linecap="round" stroke-dasharray="${num(ring)} ${num(ring)}" stroke-dashoffset="${num(ring)}"/>` +
      `<g class="ps-knob"><circle cx="${cx}" cy="${cy - r}" r="24" fill="${LEARNING.accentInk}" stroke="#FFFFFF" stroke-width="7"/></g>` +
      glyph("ON TRACK", cx, cy + 10, UI(28), INK, ' text-anchor="middle" letter-spacing="1.1"') +
      bars.join("") +
      `<rect x="26" y="660" width="338" height="130" rx="30" fill="${INK}"/>` +
      `<circle class="ps-pulse" cx="89" cy="725" r="47" fill="none" stroke="${LEARNING.accent}" stroke-width="4" opacity="0"/>` +
      `<circle cx="89" cy="725" r="33" fill="${LEARNING.accent}"/>` +
      glyph("Tap to pay", 150, 737, UI(34), LEARNING.paper);
    const motion = [
      glideTrack(
        ".ps-ring",
        { strokeDashoffset: ring },
        keyed("strokeDashoffset", fills, (beat) => ring * (1 - beat.fill)),
      ),
      glideTrack(
        ".ps-knob",
        { rotation: 0 },
        keyed("rotation", fills, (beat) => beat.fill * 360),
        { svgOrigin: `${cx} ${cy}` },
      ),
      ...bars.map((_, index) => ({
        target: `.ps-bar${index}`,
        at: 0.3 + index * 0.08,
        from: { scaleY: 0, transformOrigin: "50% 100%" },
        to: { scaleY: 1, transformOrigin: "50% 100%", duration: 0.4, ease: "power3.out" },
      })),
      ...pays.slice(0, 1).map((beat) => glow(".ps-pulse", beat.at, { scale: 1.6, fromScale: 1, repeatDelay: 0.6, until: duration })),
    ];
    return { svg: `<defs>${coinDefs(seed)}</defs>` + svg, motion };
  },
};

const JARS = { save: { x: 28, lid: LEARNING.accent, rows: 3 }, spend: { x: 206, lid: INK, rows: 1 } };
const JAR = { y: 440, w: 156, h: 290, row: 22, rows: 7, fall: 0.45 };

const allowance = {
  check: (beat) => (Object.hasOwn(JARS, beat.jar) ? null : `jar is save or spend, not ${beat.jar}`),
  sfx: (beats) => beats.map((beat) => ({ at: beat.at + JAR.fall, sound: "tick" })),
  draw({ beats, seed }) {
    const trailDef = `<linearGradient id="s${seed}-trail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${LEARNING.accent}" stop-opacity="0"/><stop offset="1" stop-color="${LEARNING.accent}" stop-opacity="0.45"/></linearGradient>`;
    let svg = `<defs>${coinDefs(seed)}${trailDef}</defs>` + title("Allowance");
    // Each falling coin draws inside its jar's glass and behind its lid, so it drops in rather than onto it.
    const falling = { save: "", spend: "" };
    svg += `<rect x="30" y="154" width="330" height="16" rx="8" fill="${INK}" fill-opacity="0.1"/><rect class="ps-progress" x="30" y="154" width="330" height="16" rx="8" fill="${LEARNING.accent}"/>`;
    const motion = [];
    beats.forEach((beat, index) => {
      const jar = JARS[beat.jar];
      const landing = JAR.y + 70;
      const trail = `<rect x="${jar.x + JAR.w / 2 - 22}" y="${landing - 130}" width="44" height="120" rx="22" fill="url(#s${seed}-trail)"/>`;
      falling[beat.jar] += `<g class="ps-coin${index}" opacity="0">${trail}${coin(seed, jar.x + JAR.w / 2, landing, 34, 0.7)}</g>`;
      motion.push(
        { target: `.ps-coin${index}`, at: beat.at, from: { y: -(landing + 60) }, to: { y: 0, duration: JAR.fall, ease: "power2.in" } },
        show(`.ps-coin${index}`, beat.at),
        hide(`.ps-coin${index}`, beat.at + JAR.fall + 0.08),
      );
    });
    Object.entries(JARS).forEach(([name, jar]) => {
      const clip = `s${seed}-jar-${name}`;
      const stack = Array.from({ length: JAR.rows }, (_, row) =>
        [0, 1, 2]
          .map((column) => coin(seed, jar.x + JAR.w * (0.25 + column * 0.25) + (row % 2 ? 8 : -8), JAR.y + JAR.h - 30 - row * JAR.row, JAR.w * 0.15))
          .join(""),
      ).join("");
      svg +=
        `<clipPath id="${clip}"><rect x="${jar.x + 6}" y="${JAR.y + 26}" width="${JAR.w - 12}" height="${JAR.h - 32}" rx="${num(JAR.w * 0.2)}"/></clipPath>` +
        `<rect x="${jar.x}" y="${JAR.y + 20}" width="${JAR.w}" height="${JAR.h - 20}" rx="${num(JAR.w * 0.22)}" fill="#FFFFFF" fill-opacity="0.55" stroke="${INK}" stroke-opacity="0.18" stroke-width="3"/>` +
        `<g clip-path="url(#${clip})"><g class="ps-stack-${name}">${stack}</g></g>` +
        falling[name] +
        `<rect x="${num(jar.x + JAR.w * 0.12)}" y="${JAR.y + 50}" width="${num(JAR.w * 0.07)}" height="${num(JAR.h * 0.6)}" rx="6" fill="#FFFFFF" fill-opacity="0.7"/>` +
        `<rect x="${jar.x - 6}" y="${JAR.y}" width="${JAR.w + 12}" height="34" rx="12" fill="${jar.lid}"/>` +
        glyph(
          name.toUpperCase(),
          jar.x + JAR.w / 2,
          JAR.y + JAR.h + 50,
          { ...LEARNING.type.mono, weight: 700, size: 30 },
          INK,
          ' text-anchor="middle" letter-spacing="3.6"',
        );
      const mine = beats.filter((beat) => beat.jar === name);
      const hidden = (rows) => (JAR.rows - rows) * JAR.row;
      const landings = mine.map((beat) => ({ at: beat.at + JAR.fall }));
      motion.push(
        glideTrack(
          `.ps-stack-${name}`,
          { y: hidden(jar.rows) },
          keyed("y", landings, (_, index) => hidden(jar.rows + index + 1)),
          { glide: 0.25 },
        ),
      );
    });
    const landings = beats.map((beat) => ({ at: beat.at + JAR.fall }));
    const share = (_, index) => 0.3 + (0.7 * (index + 1)) / beats.length;
    motion.push(glideTrack(".ps-progress", { scaleX: 0.3 }, keyed("scaleX", landings, share), { glide: 0.3, svgOrigin: "30 162" }));
    return { svg, motion };
  },
};

const cart = {
  check: (beat) => (beat.remove === true ? null : "the cart's beat is remove: true"),
  sfx: (beats) =>
    beats.flatMap((beat) => [
      { at: beat.at, sound: "swish" },
      { at: beat.at + 0.3, sound: "tick" },
    ]),
  draw({ beats, cue }) {
    const [first, second = ""] = (cue.item ?? "Toy set").split(" ");
    const white = (text, x, y, size, extra = "") => glyph(text, x, y, UI(size), "#FFFFFF", extra);
    const svg =
      title("Cart") +
      `<g class="ps-badge"><circle cx="331" cy="109" r="29" fill="${LEARNING.accentInk}"/>` +
      `<g class="ps-count1">${white("1", 331, 121, 32, ' text-anchor="middle"')}</g><g class="ps-count0" opacity="0">${white("0", 331, 121, 32, ' text-anchor="middle"')}</g></g>` +
      `<g class="ps-row"><rect x="24" y="190" width="342" height="210" rx="28" fill="${LEARNING.accentInk}"/>` +
      white("REMOVE", 340, 306, 30, ' text-anchor="end" letter-spacing="1.2"') +
      `<g class="ps-item" style="filter:drop-shadow(0 16px 17px rgba(23,34,48,.18))"><rect x="24" y="190" width="342" height="210" rx="28" fill="#FFFFFF"/>` +
      `<rect x="46" y="220" width="150" height="150" rx="22" fill="${S.bubble}"/>${toyBricks(55, 229, 132)}` +
      glyph(first, 216, 290, UI(34), INK) +
      glyph(second, 216, 330, UI(34), INK) +
      `</g></g><rect x="24" y="650" width="342" height="120" rx="60" fill="${INK}" fill-opacity="0.1"/>` +
      `<g class="ps-checkout">${glyph("Checkout", 195, 721, UI(32), INK, ' text-anchor="middle" fill-opacity="0.55"')}</g>` +
      `<g class="ps-empty" opacity="0">${glyph("Cart is empty", 195, 721, UI(32), INK, ' text-anchor="middle" fill-opacity="0.55"')}</g>`;
    const motion = beats.slice(0, 1).flatMap((beat) => [
      {
        target: ".ps-item",
        at: beat.at,
        from: { x: 0, rotation: 0, svgOrigin: "195 295" },
        to: { x: -300, rotation: -4, svgOrigin: "195 295", duration: 0.45, ease: "power3.in" },
      },
      hide(".ps-count1", beat.at + 0.3),
      show(".ps-count0", beat.at + 0.3),
      pop(".ps-badge", beat.at + 0.3, "snappy", { from: 1.3, origin: "50% 50%" }),
      // The emptied row folds away, as a real cart does once its last item goes.
      {
        target: ".ps-row",
        at: beat.at + 0.5,
        from: { opacity: 1, scaleY: 1, svgOrigin: "195 190" },
        to: { opacity: 0, scaleY: 0.6, svgOrigin: "195 190", duration: 0.3, ease: "power2.in" },
      },
      hide(".ps-checkout", beat.at + 0.4),
      { target: ".ps-empty", at: beat.at + 0.4, from: { opacity: 0, y: 12 }, to: { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" } },
    ]);
    return { svg, motion, shakeAt: beats.length ? beats[0].at + 0.3 : undefined };
  },
};

module.exports = { SCREENS: { savings, allowance, cart }, MIN_PT };
