// Created by The Angelo Umali.
// paperScene: the learning vlog's full-frame cream sheet (s_info.png, s_cta.png), a faint dot grid under a warm centre
// glow. It slides over the footage with a hard gold-ruled edge and off again; opaque in between, so captions and cards
// placed after it in the sheet draw on it in ink (learning/cover.js).
const { unit, box } = require("../../brand/html");
const { LEARNING } = require("../../learning/tokens");
const { microLabel } = require("./typing");
const { drawOn } = require("../../fx/ink");
const { nodePop, vectorZ } = require("../intro");

const { sheet: SHEET } = LEARNING;
const [W, H] = [1080, 1920];
// Where the sheet sits off frame before entering or after leaving, and the edge facing the footage while it slides.
const ENTERS = { up: { from: { y: H }, edge: [0, 0, W, SHEET.edge] }, left: { from: { x: -W }, edge: [W - SHEET.edge, 0, SHEET.edge, H] }, cut: null };
const EXITS = {
  up: { to: { y: -H }, edge: [0, H - SHEET.edge, W, SHEET.edge] },
  right: { to: { x: W }, edge: [0, 0, SHEET.edge, H] },
  down: { to: { y: H }, edge: [0, 0, W, SHEET.edge] },
  cut: null,
};

function directions(cue) {
  const enter = cue.enter ?? "up";
  const leave = cue.exit ?? "up";
  if (!Object.hasOwn(ENTERS, enter)) throw new Error(`paperScene enter is ${Object.keys(ENTERS).join(", ")}, not ${enter}`);
  if (!Object.hasOwn(EXITS, leave)) throw new Error(`paperScene exit is ${Object.keys(EXITS).join(", ")}, not ${leave}`);
  return { enter: ENTERS[enter], leave: EXITS[leave] };
}

// Each slide's length; a scene too short for both shares its span between them.
function timing(cue, duration) {
  const { enter, leave } = directions(cue);
  const wanted = (enter ? SHEET.slide : 0) + (leave ? SHEET.slide : 0);
  const fit = wanted > duration ? duration / wanted : 1;
  const enterFor = enter ? SHEET.slide * fit : 0;
  const leaveFor = leave ? SHEET.slide * fit : 0;
  return { enter, leave, enterFor, leaveFor, leaveAt: duration - leaveFor };
}

function ground(cue) {
  const dots = `s${cue.seed}-dots`;
  const glow = `s${cue.seed}-glow`;
  const [cx, cy] = SHEET.glowCentre;
  const gap = SHEET.dotGap;
  return (
    `<defs><pattern id="${dots}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse">` +
    `<circle cx="${gap / 2}" cy="${gap / 2}" r="${SHEET.dotRadius}" fill="${LEARNING.ink}" fill-opacity="${SHEET.dotOpacity}"/></pattern>` +
    `<radialGradient id="${glow}" cx="${cx}" cy="${cy}" r="${SHEET.glowRadius}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${SHEET.glow}" stop-opacity="${SHEET.glowOpacity}"/><stop offset="1" stop-color="${SHEET.glow}" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="${LEARNING.paper}"/><rect width="${W}" height="${H}" fill="url(#${glow})"/>` +
    `<rect width="${W}" height="${H}" fill="url(#${dots})"/>`
  );
}

function label(cue) {
  return cue.label ? microLabel(cue.label, cue.labelX ?? SHEET.labelX, cue.labelY ?? SHEET.labelY) : "";
}

// The kit's vector Z (the logo master, steel over gold), drawn on stroke by stroke once the sheet has landed at `at`.
function logo(cue, at) {
  if (!cue.logo) return { html: "", motion: [] };
  const { x, y, height, drawFor, gap } = { ...SHEET.logo, ...cue.logo };
  return {
    html: vectorZ({ logo: { height, centre: [x, y] } }),
    motion: [
      nodePop(".z-snode", at),
      drawOn(".z-steel", at + 0.05, { duration: drawFor }),
      drawOn(".z-gold", at + 0.05 + gap, { duration: drawFor }),
      nodePop(".z-gnode", at + 0.05 + gap + drawFor),
    ],
  };
}

// The gold rule on the edge facing the footage, shown only while its slide runs.
const edge = (name, [x, y, w, h]) => unit(`${name} pre`, `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${LEARNING.rule}"/>`);
const edgeShown = (name, at, seconds) => ({
  target: `.${name}`,
  at,
  to: {
    keyframes: [
      { opacity: 1, duration: 0 },
      { opacity: 1, duration: seconds },
      { opacity: 0, duration: 0 },
    ],
  },
});

const paperScene = {
  track: 4,
  sfx: (cue, duration) => {
    const { enter, leave, leaveAt } = timing(cue, duration);
    return [...(enter ? [{ at: 0, sound: "swish" }] : []), ...(leave ? [{ at: leaveAt, sound: "whipOut" }] : [])];
  },
  render(cue, { duration }) {
    const { enter, leave, enterFor, leaveFor, leaveAt } = timing(cue, duration);
    const edges = (enter ? edge("edge-in", enter.edge) : "") + (leave ? edge("edge-out", leave.edge) : "");
    const axis = (to) => Object.keys(to)[0];
    const mark = logo(cue, enterFor);
    return {
      html: box("sheet", [0, 0, W, H], unit("ground", ground(cue) + label(cue)) + mark.html + edges),
      motion: [
        ...(enter
          ? [
              { target: ".sheet", at: 0, from: enter.from, to: { [axis(enter.from)]: 0, duration: enterFor, ease: "power3.out" } },
              edgeShown("edge-in", 0, enterFor),
            ]
          : []),
        ...mark.motion,
      ],
      exit: leave
        ? [
            {
              target: ".sheet",
              at: leaveAt,
              from: { [axis(leave.to)]: 0 },
              to: { ...leave.to, duration: leaveFor, ease: "power2.in", immediateRender: false },
            },
            edgeShown("edge-out", leaveAt, leaveFor),
          ]
        : [],
    };
  },
};

module.exports = { paperScene };
