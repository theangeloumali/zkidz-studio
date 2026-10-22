// Created by The Angelo Umali.
// Story charts with no canvas twin: the headline stack (paper slips landing on their words, the last one turning gold)
// and the line chart (a stroke drawing on with a dot and a counting value riding its tip, one gold focus point).
const { unit, drawable } = require("../brand/html");
const { rise, fade, pop, show } = require("../fx/motion");
const { scrim } = require("../fx/light");
const { drawOn, glow } = require("../fx/ink");
const { odometer } = require("../fx/kinetic");
const { spring } = require("../fx/springs");
const { k, still, drawn, join, NOTHING, idOf, card, panelCard, head, risingText } = require("./parts");

const STACK = { font: { ...k.TYPE.display, size: 64 }, maxText: 760, padX: 56, minWidth: 420, overlap: 0.08, slack: 24, nudge: 50, tilt: [1.5, 3.5] };

// Slips overlap down the band, each nudged and tilted from the cue seed (mulberry32), so a rebuild lands them the same.
function stackLayout(cue) {
  const texts = [...cue.items.map((item) => item.text), cue.final];
  const font = { ...STACK.font, size: Math.min(...texts.map((text) => k.fitFontSize(text, STACK.font, STACK.maxText))) };
  const h = font.size * 1.9;
  const step = h * (1 - STACK.overlap); // each slip covers only the edge of the one before, so every headline stays readable
  const height = (texts.length - 1) * step + h + 2 * STACK.slack;
  const top = k.bandTop(cue.y, height);
  const rand = k.mulberry32(cue.seed * 7919 + 104729);
  const itemAt = (index) => cue.items[index].at ?? 0.3 + index * 0.9;
  const lastAt = cue.items.length ? itemAt(cue.items.length - 1) : 0;
  const slips = texts.map((text, index) => {
    const w = Math.max(STACK.minWidth, k.textWidth(text, font) + 2 * STACK.padX);
    const [low, high] = STACK.tilt;
    const tilt = (index % 2 ? 1 : -1) * (low + rand() * (high - low));
    const centre = [k.PW / 2 + (rand() - 0.5) * 2 * STACK.nudge, top + STACK.slack + h / 2 + index * step];
    const final = index === texts.length - 1;
    const at = final ? (cue.finalAt ?? lastAt + 1.2) : itemAt(index);
    return { text, index, final, w, h, centre, tilt, at };
  });
  return { font, slips, rect: [k.SAFE.left, top, k.PANEL_W, height], clearAt: slips.at(-1).at + 0.5 };
}

// A slip lands from 1.6x out of a blur at its tilt; the others then fly off sideways and the final one rights itself in
// the middle of the band as its gold fill comes up.
function slip(cue, layout, { text, index, final, w, h, centre, tilt, at }) {
  const name = `slip${index}`;
  const rect = [centre[0] - w / 2, centre[1] - h / 2, w, h];
  const baseline = h / 2 + layout.font.size * 0.28;
  const ink = (s) => s.drawText(text, w / 2, baseline, { ...layout.font, color: k.BRAND.ink, align: "center", wobble: 0.3 });
  const gold = final
    ? drawn(cue, "final-gold", (s) => s.wobblyFill(s.rectPoints(5, 5, w - 10, h - 10), k.BRAND.goldBright), [w / 2, h / 2], { pre: true })
    : "";
  const paper = card(cue, name, rect, { html: gold + drawn(cue, `${name}-text`, ink), motion: [] }, { lift: false });
  const target = `.${name}`;
  const { clearAt } = layout;
  const [, top, , height] = layout.rect;
  const leave = final
    ? [
        {
          target,
          at: clearAt,
          from: { y: 0, rotation: tilt },
          to: { y: top + height / 2 - centre[1], rotation: 0, duration: 0.6, ease: "power3.inOut", immediateRender: false },
        },
        show(".final-gold", clearAt + 0.15),
      ]
    : [
        {
          target,
          at: clearAt + index * 0.05,
          from: { x: 0, opacity: 1 },
          to: { x: (index % 2 ? 1 : -1) * 760, opacity: 0, duration: 0.45, ease: "power3.in", immediateRender: false },
        },
      ];
  return {
    html: paper.html,
    motion: [
      { target, at, from: { scale: 1.6, rotation: tilt * 0.3 }, to: { scale: 1, rotation: tilt, ...spring("snappy") } },
      {
        target,
        at,
        from: { opacity: 0, filter: "blur(12px)" },
        to: { opacity: 1, filter: "blur(0px)", clearProps: "filter", duration: 0.3, ease: "power2.out" },
      },
      ...leave,
    ],
  };
}

const headlineStack = {
  sfx: (cue, duration) => {
    const { slips, clearAt } = stackLayout(cue);
    return [
      ...slips.map(({ at, index }) => ({ at, sound: "tick", pan: index % 2 ? 0.25 : -0.25 })),
      { at: clearAt, sound: "nodeGold" },
      { at: duration - k.EXIT, sound: "swishOut" },
    ];
  },
  render(cue, { duration }) {
    const layout = stackLayout(cue);
    return join(scrim("stack-scrim", layout.rect, 0, duration), ...layout.slips.map((each) => slip(cue, layout, each)));
  },
};

const CHART = { plotHeight: 260, valueRoom: 70, labelGap: 44, labelFont: { ...k.TYPE.mono, size: 28 }, valueFont: { ...k.TYPE.display, size: 44 } };
const DRAW = { at: 0.5, duration: 1.2, ease: "power2.inOut" };
// power2.inOut solved for time: when the drawing stroke reaches `progress` of its length.
const drawTimeOf = (progress) => DRAW.at + DRAW.duration * (progress < 0.5 ? Math.sqrt(progress / 2) : 1 - Math.sqrt((1 - progress) / 2));

function chartLayout(cue) {
  const headLayout = k.headLayout(cue.kicker, cue.title);
  const left = k.CARD_PAD + 20;
  const right = k.PANEL_W - k.CARD_PAD - 60;
  const plotTop = headLayout.bottom + CHART.valueRoom;
  const plotBottom = plotTop + CHART.plotHeight;
  const values = cue.points.map(([, value]) => value);
  const low = Math.min(0, ...values);
  const high = Math.max(...values);
  const step = cue.points.length > 1 ? (right - left) / (cue.points.length - 1) : 0;
  const points = values.map((value, index) => [left + index * step, plotBottom - ((value - low) / (high - low || 1)) * CHART.plotHeight]);
  const labelBaseline = plotBottom + CHART.labelGap;
  const noteBaseline = labelBaseline + 64;
  return { headLayout, left, right, plotBottom, points, labelBaseline, noteBaseline, height: (cue.note ? noteBaseline : labelBaseline) + k.CARD_PAD };
}

// Where the tip is at each of `samples` even steps along the line, as x/y offsets from its first point.
function tipPath(points, samples = 48) {
  const [x0, y0] = points[0];
  const along = Array.from({ length: samples + 1 }, (_, index) => k.pointAlong(points, index / samples));
  return { x: along.map(([x]) => x - x0), y: along.map(([, y]) => y - y0) };
}

const ride = (target, path) => ({ target, at: DRAW.at, to: { keyframes: { ...path, easeEach: "none" }, duration: DRAW.duration, ease: DRAW.ease } });

function drawLineChart(cue, duration) {
  const layout = chartLayout(cue);
  const { points, left, right, plotBottom, labelBaseline } = layout;
  const lengths = points.map((_, index) => k.pathLength(points.slice(0, index + 1)));
  const total = lengths.at(-1) || 1;
  const path = tipPath(points);
  const [x0, y0] = points[0];
  const last = cue.points.at(-1)[1];
  const value = odometer("tip-value", {
    text: `${k.formatCount(last)}${cue.suffix ?? ""}`,
    right: x0 + 40,
    baseline: y0 - 26,
    font: CHART.valueFont,
    colour: k.BRAND.ink,
    at: DRAW.at,
    roll: { duration: DRAW.duration, ease: DRAW.ease },
    idPrefix: idOf(cue, "odo"),
  });
  const line = still(cue, "line", (s) => s.sketchPath(points, { color: k.BRAND.steel, width: 6, passes: 1, rough: 0.6, sharp: true }));
  const labels = cue.points.map(([label], index) => {
    const [x] = points[index];
    const colour = index === cue.focus ? k.BRAND.goldInk : k.BRAND.muted;
    return {
      html: drawn(cue, `label${index}`, (s) => s.drawText(String(label), x, labelBaseline, { ...CHART.labelFont, color: colour, align: "center", wobble: 0 }), [
        x,
        labelBaseline,
      ]),
      motion: rise(`.label${index}`, 0.3 + index * 0.06, { distance: 14, scaleFrom: 1 }),
    };
  });
  const focus = cue.focus === undefined ? NOTHING : focusPoint(cue, points[cue.focus], drawTimeOf(lengths[cue.focus] / total));
  const content = join(
    head(cue, cue.kicker, cue.title, layout.headLayout),
    {
      html: drawn(cue, "axis", (s) => s.sketchLine(left, plotBottom, right, plotBottom, { color: k.BRAND.line, width: 3, passes: 1, overshoot: 0 })),
      motion: [],
    },
    ...labels,
    { html: unit("line", drawable(line)), motion: [drawOn(".line path", DRAW.at, { duration: DRAW.duration, ease: DRAW.ease })] },
    focus,
    {
      html:
        drawn(cue, "tip", (s) => s.sketchEllipse(x0, y0, 9, 9, { fill: k.BRAND.steel, stroke: false }), [x0, y0]) + unit("tip-ride", "", [x0, y0], value.html),
      motion: [pop(".tip", DRAW.at - 0.1), ride(".tip", path), ride(".tip-ride", path), ...value.motion, fade(".tip-ride", DRAW.at - 0.1)],
    },
    cue.note
      ? risingText(cue, "note", cue.note, k.CARD_PAD, layout.noteBaseline, k.TYPE.body, DRAW.at + DRAW.duration + 0.2, { color: k.BRAND.muted })
      : NOTHING,
  );
  return panelCard(cue, cue.y, layout.height, content, { accent: cue.focus === undefined, duration });
}

// The focus point: a gold node popping as the tip passes it, with one glow ring.
function focusPoint(cue, [x, y], at) {
  return {
    html:
      drawn(cue, "focus", (s) => s.nodeRing(x, y, 14, { color: k.BRAND.gold, surface: k.BRAND.paper }), [x, y]) +
      drawn(cue, "focus-glow", (s) => s.sketchEllipse(x, y, 22, 22, { color: k.BRAND.gold, width: 3, passes: 1 }), [x, y], { pre: true }),
    motion: [pop(".focus", at), glow(".focus-glow", at + 0.1)],
  };
}

const lineChart = {
  sfx: (cue, duration) => {
    const { points } = chartLayout(cue);
    const lengths = points.map((_, index) => k.pathLength(points.slice(0, index + 1)));
    return k.cardSfx(duration, [
      { at: DRAW.at, sound: "rule" },
      { at: DRAW.at, sound: "count", dur: DRAW.duration },
      ...(cue.focus === undefined ? [] : [{ at: drawTimeOf(lengths[cue.focus] / (lengths.at(-1) || 1)), sound: "nodeGold" }]),
    ]);
  },
  render: (cue, { duration }) => drawLineChart(cue, duration),
};

module.exports = { headlineStack, lineChart };
