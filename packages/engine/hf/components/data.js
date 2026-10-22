// Created by The Angelo Umali.
// Data cards (canvas brand-data.js, brand-flow.js, rows.js): the counting stat tile, the dated timeline and the flow row.
// Canvas layout and beats; the effects ride on top.
const { rise, pop } = require("../fx/motion");
const { glow } = require("../fx/ink");
const { odometer } = require("../fx/kinetic");
const { burst } = require("../fx/impact");
const { springLanding } = require("../fx/springs");
const { k, drawn, join, idOf, NOTHING, SETTLED_RISE, card, panelCard, goldRule, kicker, head, risingText, arrow } = require("./parts");

// Stat tile: an ink tile whose figures roll in like an odometer on the counter spring and land with a burst of gold
// specks; the goldBright suffix pops after them.
// When the counting figures land, at the canvas counter's settle (the count sound's pluck).
const statLanding = (duration) => k.STAT.countFrom + springLanding("counter", k.countSpeed(duration)).duration;

const statTile = {
  // The canvas sounds, plus a shimmer as the number lands with its sparks.
  sfx: (cue, duration) => [...k.SFX_OF.statTile(cue, duration), ...(k.statLayout(cue).counts ? [{ at: statLanding(duration), sound: "shimmer" }] : [])],
  render(cue, { duration }) {
    const { STAT } = k;
    const layout = k.statLayout(cue);
    const { parts, numberFont, numberRight, numberInk, suffixInk, numberBaseline } = layout;
    const roll = springLanding("counter", k.countSpeed(duration));
    const figures = layout.counts
      ? odometer("number", {
          text: parts.number,
          right: numberRight,
          baseline: numberBaseline,
          font: numberFont,
          colour: numberInk.color,
          at: STAT.countFrom,
          roll,
          idPrefix: idOf(cue, "odo"),
        })
      : { html: drawn(cue, "number", (s) => s.drawText(parts.number, numberRight, numberBaseline, { ...numberInk, align: "right" })), motion: [] };
    const middle = [numberRight - k.textWidth(parts.number, numberFont) / 2, numberBaseline - numberFont.size * 0.35];
    // The number lands with a burst of gold specks and one gold ring opening out from it.
    const landed = statLanding(duration);
    const ringRadius = numberFont.size * 0.6;
    const sparks = layout.counts
      ? join(
          burst("spark", cue.seed, middle, landed, {
            count: 28,
            colour: k.BRAND.goldBright,
            reach: [numberFont.size * 0.7, numberFont.size * 1.5],
            size: [4, 9],
            idPrefix: idOf(cue, "spark"),
          }),
          {
            html: drawn(cue, "ring", (s) => s.sketchEllipse(...middle, ringRadius, ringRadius, { color: k.BRAND.goldBright, width: 5, passes: 1 }), middle, {
              pre: true,
            }),
            motion: [glow(".ring", landed, { duration: 0.6, fromScale: 0.5, scale: 2.2, fromOpacity: 1 })],
          },
        )
      : NOTHING;
    const suffixAt = [numberRight + 10, numberBaseline];
    const content = join(
      cue.label ? kicker(cue, "label", cue.label, k.CARD_PAD, k.HEAD_KICKER, 0.1, { color: k.BRAND.steelOnInk, size: STAT.labelFont.size }) : NOTHING,
      { html: parts.prefix ? drawn(cue, "prefix", (s) => s.drawText(parts.prefix, k.CARD_PAD, numberBaseline, numberInk)) : "", motion: [] },
      figures,
      sparks,
      parts.suffix
        ? {
            html: drawn(cue, "suffix", (s) => s.drawText(parts.suffix, ...suffixAt, suffixInk), suffixAt),
            motion: rise(".suffix", STAT.suffixAt, { preset: "snappy", distance: 0, scaleFrom: 0.5 }),
          }
        : NOTHING,
      cue.sub
        ? risingText(cue, "sub", cue.sub, k.CARD_PAD, layout.subBaseline, layout.subFont, cue.subAt ?? STAT.subAt, { color: k.BRAND.mutedOnInk })
        : NOTHING,
    );
    return card(cue, "card", [k.SAFE.left, k.bandTop(cue.y, layout.height), layout.width, layout.height], content, {
      tone: "ink",
      edge: k.BRAND.lineStrong,
      duration,
    });
  },
};

// Timeline: the gold rail draws node to node as each step lands; nodes pop, a hot one glows, dates and subs rise.
const timeline = {
  render(cue, { duration }) {
    const layout = k.timelineLayout(cue);
    const { railY, centerX } = layout;
    const steps = cue.steps.map((step, index) => {
      const at = k.timelineNodeAt(step, index);
      const node = [centerX(index), railY];
      const halo = step.hot
        ? drawn(cue, `halo${index}`, (s) => s.sketchEllipse(...node, 22, 22, { color: k.BRAND.gold, width: 3, passes: 1 }), node, { pre: true })
        : "";
      const rail = index
        ? goldRule(cue, `rail${index}`, centerX(index - 1), railY, centerX(index) - centerX(index - 1), k.timelineAt(step, index), { node: false })
        : NOTHING;
      return join(rail, {
        html:
          drawn(cue, `node${index}`, (s) => s.drawTimelineNode(step, index, layout, 1), node) +
          halo +
          drawn(cue, `step${index}`, (s) => s.drawTimelineStep(step, index, layout, SETTLED_RISE), node),
        motion: [pop(`.node${index}`, at), ...(halo ? [glow(`.halo${index}`, at + 0.1)] : []), ...rise(`.step${index}`, at, { distance: 14, scaleFrom: 1 })],
      });
    });
    const content = join(head(cue, null, cue.text, layout.head), ...steps);
    return panelCard(cue, cue.y, layout.height, content, { duration });
  },
};

// Flow row: boxes lift in turn, each led in by an arrow drawing from its node-ring tail; the last box is the ink highlight.
const flowRow = {
  render(cue, { duration }) {
    const { FLOW } = k;
    const { boxW, head: headLayout, items } = k.flowLayout(cue);
    const boxes = items.map((item, index) => {
      const { x, at, tone } = item;
      const words = drawn(cue, `words${index}`, (s) => s.drawScaled(boxW / 2, FLOW.boxHeight / 2, 1, () => s.drawFlowWords(item, boxW)));
      const flowBox = card(
        cue,
        `box${index}`,
        [x, FLOW.rowY - FLOW.boxHeight / 2, boxW, FLOW.boxHeight],
        { html: words, motion: [] },
        { tone, at, edgeWidth: FLOW.edge },
      );
      if (!index) return flowBox;
      const tail = [x - FLOW.gap + 12, FLOW.rowY];
      return join(
        { html: drawn(cue, `tail${index}`, (s) => s.flowTail(x, 1), tail), motion: [pop(`.tail${index}`, at - FLOW.lead)] },
        arrow(cue, `arrow${index}`, (s, progress) => s.flowArrow(x, progress), [at - FLOW.lead, at]),
        flowBox,
      );
    });
    const content = join(head(cue, null, cue.text, headLayout), ...boxes);
    return panelCard(cue, k.cardTop(cue), FLOW.height, content, { accent: true, duration });
  },
};

module.exports = { statTile, timeline, flowRow };
