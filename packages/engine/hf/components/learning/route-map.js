// Created by The Angelo Umali.
// routeMap (travel showcase): a real map (Natural Earth land, geo/) with a dashed gold route that draws from stop to stop on
// each pin's beat. The current pin is orange and pulses a ring, past pins turn gold, names rise beside their pins as plain
// type with a navy halo (never a plate). It stays live while it holds: the dashes flow and, with `follow`, the view eases
// toward the current stop (<= 6% scale, <= 4% pan). Cue fields: docs/cues-hf.md.
const { unit } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { drawOn, glow } = require("../../fx/ink");
const { LEARNING } = require("../../learning/tokens");
const { glyph, fadeOut, glideTrack } = require("./typing");
const { projection, landPath } = require("./geo/projection");
const { placeLabel, PIN_RADIUS } = require("./geo/labels");

const PORTRAIT = [1080, 1920];
const NAME = { ...LEARNING.type.display, size: 46 };
const SUB = { ...LEARNING.type.display, weight: 600, size: 30 };
const TEXT = { nameTop: 33, subDrop: 38, bottom: 9, halo: 7, rise: 14, riseFor: 0.4 };
const PIN = { outline: 3, ring: 15 };
const ROUTE = { width: 6, dash: 14, gap: 11, speed: 30, bow: 0.12, flat: 60, drawMin: 0.35, drawMax: 0.7, pxPerSecond: 1500 };
const FOLLOW = { scale: 0.06, pan: 0.04, glide: 0.9, pull: 0.3, margin: 0.07 };
const FEATHER = 28;
const EDGE = 24;
const LEAVE_AT = 0.1; // the departure ring lands just after the cue starts
const MIN_HOLD = 0.3; // a pin must land this long before the cue ends

const where = (cue) => `routeMap at ${cue.start ?? cue.at}s`;
const pop = { scale: 1, opacity: 1, duration: 0.3, ease: "power3.out" };

// The top band on portrait (clear of faces); the left half on landscape (the face bubble owns the right).
const defaultBox = ([width, height]) => (width < height ? [70, 280, 940, 590] : [60, 70, 996, 560]);

function frameOf(cue) {
  const size = cue.size ?? PORTRAIT;
  const box = cue.full ? [0, 0, ...size] : cue.box ? [cue.box.x, cue.box.y, cue.box.w, cue.box.h] : defaultBox(size);
  return { size, box, project: projection(box, cue.region ?? "japan") };
}

function stopsOf(cue, duration, project) {
  const stops = cue.stops ?? [];
  if (!stops.length) throw new Error(`${where(cue)}: stops is empty`);
  const [west, south, east, north] = project.reach(0);
  stops.forEach((stop, index) => {
    if (index && stop.at < stops[index - 1].at) throw new Error(`${where(cue)}: stops are in pin order; "${stop.name}" pins before "${stops[index - 1].name}"`);
    if (stop.lon < west || stop.lon > east || stop.lat < south || stop.lat > north)
      throw new Error(`${where(cue)}: "${stop.name}" (${stop.lon}, ${stop.lat}) lies outside the map view`);
    if (!(stop.at >= 0 && stop.at <= duration - MIN_HOLD))
      throw new Error(`${where(cue)}: "${stop.name}" pins at ${stop.at}s, but the cue is ${duration.toFixed(2)}s long and the pin needs ${MIN_HOLD}s to land`);
  });
  return stops;
}

function sizeOf({ name, sub }) {
  const widest = Math.max(advanceWidth(name, NAME), sub ? advanceWidth(sub, SUB) : 0);
  return { width: Math.ceil(widest) + TEXT.halo, height: TEXT.nameTop + (sub ? TEXT.subDrop : 0) + TEXT.bottom };
}

// Pins and labels for every point (the departure first when given), in px on the page.
function layout(cue, duration, frame = frameOf(cue)) {
  const { size, box, project } = frame;
  const [x, y, w, h] = box;
  const points = [...(cue.from ? [{ ...cue.from, at: LEAVE_AT, from: true }] : []), ...stopsOf(cue, duration, project)];
  const pins = points.map((point) => project(point.lon, point.lat));
  // Labels stay clear of the edge (and of the feather), and of where a follow drift can carry them.
  const inX = EDGE + (cue.full ? 0 : FEATHER) + (cue.follow ? FOLLOW.margin * w : 0);
  const inY = EDGE + (cue.full ? 0 : FEATHER) + (cue.follow ? FOLLOW.margin * h : 0);
  // An inset hanging off the frame keeps its labels on the frame.
  const [left, top] = [Math.max(x + inX, 0), Math.max(y + inY, 0)];
  const bounds = [left, top, Math.min(x + w - inX, size[0]) - left, Math.min(y + h - inY, size[1]) - top];
  const taken = [];
  const labels = points.map((point, index) => {
    const spot = placeLabel(pins[index], sizeOf(point), bounds, taken, pins);
    taken.push(spot.rect);
    return { ...spot.rect, side: spot.side, anchor: spot.anchor, name: point.name, sub: point.sub ?? null };
  });
  return {
    size,
    box,
    points: points.map(({ name, at, from }) => ({ name, at, from: Boolean(from) })),
    pins: pins.map(([px, py]) => ({ x: px, y: py })),
    labels,
  };
}

// A flight-arc bowed toward the top of the frame; straight when the pins are close.
function arc({ x: ax, y: ay }, { x: bx, y: by }) {
  const [dx, dy] = [bx - ax, by - ay];
  const length = Math.hypot(dx, dy);
  if (length < ROUTE.flat) return { d: `M${num(ax)} ${num(ay)}L${num(bx)} ${num(by)}`, length };
  let [nx, ny] = [-dy / length, dx / length];
  if (ny > 0) [nx, ny] = [-nx, -ny];
  const [cx, cy] = [(ax + bx) / 2 + nx * length * ROUTE.bow, (ay + by) / 2 + ny * length * ROUTE.bow];
  return { d: `M${num(ax)} ${num(ay)}Q${num(cx)} ${num(cy)} ${num(bx)} ${num(by)}`, length: length * 1.04 };
}

const halo = ` stroke="${LEARNING.ink}" stroke-width="${TEXT.halo}" stroke-linejoin="round" paint-order="stroke"`;

function labelUnit(label, index) {
  const x = label.anchor === "start" ? label.x : label.anchor === "end" ? label.x + label.w : label.x + label.w / 2;
  const extra = ` text-anchor="${label.anchor}"${halo}`;
  const name = glyph(label.name, x, label.y + TEXT.nameTop, NAME, LEARNING.white, extra);
  const sub = label.sub ? glyph(label.sub, x, label.y + TEXT.nameTop + TEXT.subDrop, SUB, LEARNING.white, extra) : "";
  return unit(`rm-label rm-label${index}`, name + sub, [x, label.y]);
}

function pinParts(placed, index) {
  const { x, y } = placed.pins[index];
  const [cx, cy] = [num(x), num(y)];
  const outline = `stroke="${LEARNING.ink}" stroke-width="${PIN.outline}"`;
  if (placed.points[index].from) {
    const ring = `<circle cx="${cx}" cy="${cy}" r="${PIN_RADIUS}" fill="${LEARNING.ink}" stroke="${LEARNING.accent}" stroke-width="5"/>`;
    return [unit("rm-from", ring, [x, y]), ""];
  }
  const gold =
    index < placed.points.length - 1
      ? `<circle class="rm-gold${index}" cx="${cx}" cy="${cy}" r="${PIN_RADIUS}" fill="${LEARNING.accent}" ${outline} opacity="0"/>`
      : "";
  const hot = `<circle class="rm-hot${index}" cx="${cx}" cy="${cy}" r="${PIN_RADIUS}" fill="${LEARNING.accentInk}" ${outline}/>`;
  const ring = `<circle cx="${cx}" cy="${cy}" r="${PIN.ring}" fill="none" stroke="${LEARNING.accentInk}" stroke-width="4"/>`;
  return [unit(`rm-pin${index}`, gold + hot, [x, y]), unit(`rm-ring${index} pre`, ring, [x, y])];
}

// Each leg is a dashed path revealed by a mask whose white stroke draws on (so the dash pattern itself never stretches).
function routeLegs(placed, id) {
  const [width, height] = placed.size;
  const legs = placed.pins.slice(1).map((end, index) => ({ ...arc(placed.pins[index], end), end: index + 1 }));
  const svg = legs
    .map(
      (leg, index) =>
        `<mask id="${id}-leg${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">` +
        `<path class="rm-draw${index}" d="${leg.d}" pathLength="1" stroke-dasharray="1 3" stroke-dashoffset="1.1" fill="none" stroke="#fff" stroke-width="${ROUTE.width * 3}" stroke-linecap="round"/></mask>` +
        `<g mask="url(#${id}-leg${index})"><path class="rm-flow" d="${leg.d}" fill="none" stroke="${LEARNING.accent}" stroke-width="${ROUTE.width}" stroke-linecap="round" stroke-dasharray="${ROUTE.dash} ${ROUTE.gap}"/></g>`,
    )
    .join("");
  return { legs, html: unit("rm-routes", svg) };
}

function baseLayer({ box, project }, full) {
  const [x, y, w, h] = box;
  const slack = 0.2; // the follow pan never shows the sea's edge
  const sea = `<rect x="${num(x - w * slack)}" y="${num(y - h * slack)}" width="${num(w * (1 + 2 * slack))}" height="${num(h * (1 + 2 * slack))}" fill="${LEARNING.ink}"${full ? "" : ' fill-opacity="0.66"'}/>`;
  return unit("rm-base", `${sea}<path d="${landPath(project)}" fill="${LEARNING.paper}"/>`);
}

// The inset fades out over FEATHER px at its box edge instead of ending on a line.
function featherStyle([x, y, w, h], [width, height]) {
  const ramp = (axis, start, length, total) => {
    const [a, b, c, d] = [start, start + FEATHER, start + length - FEATHER, start + length].map((value) => `${num(value)}px`);
    return `linear-gradient(to ${axis}, transparent 0, transparent ${a}, #000 ${b}, #000 ${c}, transparent ${d}, transparent ${num(total)}px)`;
  };
  return `mask-image:${ramp("right", x, w, width)},${ramp("bottom", y, h, height)};mask-composite:intersect;-webkit-mask-composite:source-in;`;
}

// The view eases toward each stop as it pins: pulled FOLLOW.pull of the way to the box centre, scale and pan bounded.
function followTrack(placed) {
  const [bx, by, bw, bh] = placed.box;
  const [cx, cy] = [bx + bw / 2, by + bh / 2];
  const stops = placed.points.flatMap((point, index) => (point.from ? [] : [{ point, index }]));
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
  const pins = stops.map(({ point, index }, order) => {
    const k = 1 + (FOLLOW.scale * (order + 1)) / stops.length;
    const shift = (offset, limit) => clamp((1 - FOLLOW.pull - k) * offset, limit);
    return [point.at, { scale: k, x: shift(placed.pins[index].x - cx, FOLLOW.pan * bw), y: shift(placed.pins[index].y - cy, FOLLOW.pan * bh) }];
  });
  return glideTrack(".rm-world", { scale: 1, x: 0, y: 0 }, pins, { glide: FOLLOW.glide, ease: "power2.inOut" });
}

function pinMotion(placed, index) {
  const { at, from } = placed.points[index];
  const enter = { target: from ? ".rm-from" : `.rm-pin${index}`, at, from: { scale: 0.4, opacity: 0 }, to: pop };
  const label = { target: `.rm-label${index}`, at, from: { y: TEXT.rise, opacity: 0 }, to: { y: 0, opacity: 1, duration: TEXT.riseFor, ease: "power3.out" } };
  if (from) return [enter, label];
  const motion = [enter, glow(`.rm-ring${index}`, at, { duration: 0.6, scale: 2.4, fromScale: 0.8 }), label];
  const next = placed.points[index + 1]?.at;
  if (next !== undefined) {
    const swap = { duration: 0.3, ease: "power2.out" };
    motion.push({ target: `.rm-hot${index}`, at: next, from: { opacity: 1 }, to: { opacity: 0, ...swap, immediateRender: false } });
    motion.push({ target: `.rm-gold${index}`, at: next, from: { opacity: 0 }, to: { opacity: 1, ...swap } });
  }
  return motion;
}

const routeMap = {
  sfx: (cue) => (cue.stops ?? []).map((stop) => ({ at: stop.at, sound: "tick" })),
  render(cue, { id, duration }) {
    const frame = frameOf(cue);
    const placed = layout(cue, duration, frame);
    const route = routeLegs(placed, id);
    const parts = placed.points.map((_, index) => pinParts(placed, index));
    const [bx, by, bw, bh] = frame.box;
    const world = unit(
      "rm-world",
      "",
      [bx + bw / 2, by + bh / 2],
      baseLayer(frame, cue.full) +
        route.html +
        parts.map(([pin]) => pin).join("") +
        parts.map(([, ring]) => ring).join("") +
        placed.labels.map(labelUnit).join(""),
    );
    const html = `<div class="rm" style="position:absolute;inset:0;${cue.full ? "" : featherStyle(frame.box, frame.size)}">${world}</div>`;

    const motion = [{ target: ".rm-base", at: 0, from: { opacity: 0 }, to: { opacity: 1, duration: 0.4, ease: "power2.out" } }];
    placed.points.forEach((_, index) => motion.push(...pinMotion(placed, index)));
    route.legs.forEach((leg, index) => {
      const at = placed.points[leg.end].at;
      const reach = Math.min(ROUTE.drawMax, ROUTE.drawMin + leg.length / ROUTE.pxPerSecond);
      motion.push(drawOn(`.rm-draw${index}`, at, { duration: Math.min(reach, duration - at) }));
    });
    if (route.legs.length)
      motion.push({ target: ".rm-flow", at: 0, from: { strokeDashoffset: 0 }, to: { strokeDashoffset: -ROUTE.speed * duration, duration, ease: "none" } });
    if (cue.follow) motion.push(followTrack(placed));
    return { html, motion, exit: fadeOut(".rm", duration) };
  },
};

module.exports = { routeMap, layout, projection };
