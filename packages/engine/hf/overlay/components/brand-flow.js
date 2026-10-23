// Created by The Angelo Umali.
// Brand flow cards, things that happen in turn: a dated timeline, a title swap and dashboard status pills.
// Item `at`s (steps, pills, swapAt) are source seconds after the cue's `at`; timemap.js maps them onto the edit.

// Timeline: dated steps joined by a gold rule that grows node to node as each step lands (the card's one gold).
const TIMELINE = themed(() => ({ dateFont: { ...TYPE.mono, size: 40 }, dateDrop: 34, subSize: 34, subLine: 42, node: 12, hotNode: 16 }));

// Dates and sub lines fit their slot; subs wrap and are never cut, so the card grows instead.
function timelineLayout(cue) {
  const head = headLayout(null, cue.text);
  const slot = CARD_INNER / cue.steps.length;
  const railY = head.bottom + 90;
  const dateFont = fittedFont(
    TIMELINE.dateFont,
    cue.steps.map((step) => step.label),
    slot - 20,
  );
  const words = cue.steps.flatMap((step) => step.sub?.split(" ") ?? []);
  const subSize = fittedFont({ ...TYPE.label, size: TIMELINE.subSize }, words, slot - 14).size;
  const subFont = (step) => ({ ...(step.hot ? TYPE.label : TYPE.body), size: subSize });
  const subs = cue.steps.map((step) => (step.sub ? wrapLines(step.sub, subFont(step), slot - 14) : []));
  const subLines = Math.max(0, ...subs.map((lines) => lines.length));
  const height = railY + 34 + subLines * TIMELINE.subLine + 30;
  return { head, railY, dateFont, subFont, subs, height, centerX: (index) => CARD_PAD + slot * (index + 0.5) };
}

// A step's node on the rail, popped to `pop`: gold and larger when it is the hot one.
const drawTimelineNode = (step, index, { railY, centerX }, pop) =>
  nodeRing(centerX(index), railY, step.hot ? TIMELINE.hotNode : TIMELINE.node, { color: step.hot ? BRAND.gold : BRAND.steel, surface: BRAND.paper, pop });

// A step's date above the rail and its sub lines below, risen by `rise`.
function drawTimelineStep(step, index, { railY, centerX, dateFont, subFont, subs }, rise) {
  const textColor = step.hot ? BRAND.ink : BRAND.muted;
  riseText(step.label, centerX(index), railY - TIMELINE.dateDrop, dateFont, rise, { color: step.hot ? BRAND.ink : BRAND.lineStrong, align: "center" });
  subs[index].forEach((line, lineIndex) =>
    riseText(line, centerX(index), railY + 54 + lineIndex * TIMELINE.subLine, subFont(step), rise, { color: textColor, align: "center" }),
  );
}

COMPONENTS.timeline = (cue, env) => {
  const { local } = env;
  const layout = timelineLayout(cue);
  const { railY, centerX } = layout;
  // The rail's tip springs from each node to the next, starting at that next step's `at`.
  const tipX = cue.steps.reduce(
    (tip, step, index) => tip + (index && (centerX(index) - centerX(index - 1)) * springAt(local - timelineAt(step, index))),
    centerX(0),
  );
  panelCard(env, cue.y, layout.height, () => {
    drawHead(null, cue.text, local, layout.head);
    if (tipX > centerX(0) + 1) goldRule(centerX(0), railY, tipX - centerX(0), 1, { node: false });
    cue.steps.forEach((step, index) => {
      const at = timelineNodeAt(step, index);
      drawTimelineNode(step, index, layout, springAt(local - at, SPRING.snappy));
      const rise = riseIn(local, at, { distance: 14, scaleFrom: 1 });
      drawStill(() => drawTimelineStep(step, index, layout, rise));
    });
  });
};
SFX_OF.timeline = (cue, duration) =>
  cardSfx(
    duration,
    cue.steps.map((step, index) => ({ at: timelineNodeAt(step, index) + 0.05, sound: step.hot ? "nodeGold" : "tick", pan: tickPan(index) })),
  );

// Title swap: the old title is struck in BRAND.negative at `swapAt` (not `at`, which is the cue's own start),
// a steel arrow leads down, and the new title rises in over a gold rule.
// Beats after swapAt: the strike runs 0.35 s, the arrow draws over `arrow`, the new words rise at `words`, the rule at `rule`.
const SWAP = { oldSize: 60, newSize: 72, strike: 0.35, arrowX: CARD_PAD + 14, indent: 58, arrow: [0.15, 0.45], words: 0.3, rule: 0.55 };
const swapAt = (cue) => cue.swapAt ?? 0.8;

// The card fits its titles (a one-word swap in a full-width panel reads empty), never under 520 px.
function swapLayout(cue) {
  const head = headLayout(cue.label, null);
  const oldFont = fittedFont({ ...TYPE.display, size: SWAP.oldSize }, [cue.old], CARD_INNER);
  const newFont = fittedFont({ ...TYPE.display, size: SWAP.newSize }, [cue.new], CARD_INNER - SWAP.indent);
  const oldBaseline = head.bottom + 20 + oldFont.size * 0.76;
  const newBaseline = oldBaseline + 40 + newFont.size * 0.8;
  const labelWidth = cue.label ? trackedWidth(cue.label.toUpperCase(), TYPE.kicker, TYPE.kicker.trackingEm) : 0;
  const contentWidth = Math.max(labelWidth, textWidth(cue.old, oldFont) + 16, SWAP.indent + textWidth(cue.new, newFont) + 16);
  const width = clamp(contentWidth + 2 * CARD_PAD, 520, PANEL_W);
  return { oldFont, newFont, oldBaseline, newBaseline, width, height: newBaseline + newFont.size * 0.3 + 44 };
}

// The negative strike through the old title, drawn on to `progress` (card space).
function drawSwapStrike(cue, { oldFont, oldBaseline }, progress) {
  const y = oldBaseline - oldFont.size * 0.3;
  const from = CARD_PAD - 8;
  sketchLine(from, y, lerp(from, CARD_PAD + textWidth(cue.old, oldFont) + 8, progress), y + 4, {
    color: BRAND.negative,
    width: 6,
    passes: 1,
    rough: 1.2,
    overshoot: 0,
  });
}

// The steel arrow from the old title down to the new one, drawn on to `progress`.
const drawSwapArrow = ({ newFont, oldBaseline, newBaseline }, progress) =>
  drawArrow(SWAP.arrowX, oldBaseline + 16, SWAP.arrowX + 30, newBaseline - newFont.size * 0.3, {
    progress,
    color: BRAND.steel,
    width: 4,
    head: 14,
    bend: 0.35,
  });

// Where the new title's gold rule runs: [x, y, width].
const swapRule = (cue, { newFont, newBaseline }) => [CARD_PAD + SWAP.indent, newBaseline + newFont.size * 0.3, textWidth(cue.new, newFont)];

COMPONENTS.titleSwap = (cue, env) => {
  const { local } = env;
  const at = swapAt(cue);
  const layout = swapLayout(cue);
  const { oldFont, newFont, oldBaseline, newBaseline, width, height } = layout;
  const strike = ease.inOut(span(local, at, at + SWAP.strike));
  withMotion(SAFE.left, bandTop(cue.y, height), env, () => {
    brandCard(0, 0, width, height);
    if (cue.label) kicker(cue.label, CARD_PAD, HEAD_KICKER, local, 0.1);
    drawStill(() => {
      // Struck, the old title steps back to muted.
      const oldColor = strike > 0 ? BRAND.muted : BRAND.ink;
      riseText(cue.old, CARD_PAD, oldBaseline, oldFont, riseIn(local, 0.15, { distance: 16, scaleFrom: 1 }), { color: oldColor });
      wordsRise(cue.new, CARD_PAD + SWAP.indent, newBaseline, newFont, local, at + SWAP.words);
    });
    if (strike >= 1) drawStill(() => drawSwapStrike(cue, layout, strike));
    else if (strike > 0) drawSwapStrike(cue, layout, strike);
    const arrow = span(local, at + SWAP.arrow[0], at + SWAP.arrow[1]);
    if (arrow > 0) drawSwapArrow(layout, arrow);
    goldRule(...swapRule(cue, layout), springAt(local - at - SWAP.rule), { thickness: 4 });
  });
};
SFX_OF.titleSwap = (cue, duration) =>
  cardSfx(duration, [
    { at: swapAt(cue), sound: "scratch", dur: SWAP.strike },
    { at: swapAt(cue) + 0.57, sound: "rule" },
  ]);

// Dashboard status pills: all start unlit, then each lights on its word and its dot pops.
// tone: steel (default), gold (the win: an ink pill with goldBright text), negative or muted.
const PILL = themed(() => ({ height: 70, gap: 16, font: { ...TYPE.mono, size: 36 }, dot: 8 }));
const PILL_DOTS = themed(() => ({ steel: BRAND.steel, gold: BRAND.goldBright, negative: BRAND.negative, muted: BRAND.muted }));

function pillsLayout(cue) {
  const head = headLayout(null, cue.text);
  const bodyTop = head.bottom + 26;
  let x = 0;
  let row = 0;
  const places = cue.items.map((item) => {
    const width = Math.min(CARD_INNER, textWidth(item.text, PILL.font) + 76);
    if (x > 0 && x + width > CARD_INNER) [x, row] = [0, row + 1];
    const place = { x: CARD_PAD + x, y: bodyTop + row * (PILL.height + PILL.gap), width };
    x += width + PILL.gap;
    return place;
  });
  return { head, places, height: bodyTop + (row + 1) * (PILL.height + PILL.gap) - PILL.gap + 40 };
}

// `dot` is the lit status dot's pop (0 = the pill is unlit); unlit and lit share one seed, so they overlay exactly.
function drawPill(item, { x, y, width }, dot = 0) {
  const isLit = dot > 0;
  const isGold = item.tone === "gold";
  const points = pillPoints(x, y, width, PILL.height);
  const middle = y + PILL.height / 2;
  wobblyFill(points, isLit ? (isGold ? BRAND.ink : BRAND.white) : BRAND.paper);
  sketchPath(points, { color: isLit ? (isGold ? BRAND.ink : BRAND.lineStrong) : BRAND.line, width: 2.5, passes: 1, rough: 0.6 });
  if (isLit) sketchEllipse(x + 30, middle, PILL.dot * dot, PILL.dot * dot, { fill: PILL_DOTS[item.tone ?? "steel"], stroke: false });
  const color = isLit ? (isGold ? BRAND.goldBright : BRAND.ink) : BRAND.muted;
  drawText(item.text, x + 50, middle + PILL.font.size * 0.36, { ...PILL.font, color, alpha: isLit ? 1 : 0.55, maxWidth: width - 66, wobble: 0 });
}

COMPONENTS.pills = (cue, env) => {
  const { local } = env;
  const { head, places, height } = pillsLayout(cue);
  const hasGold = cue.items.some((item) => item.tone === "gold");
  panelCard(
    env,
    cue.y,
    height,
    () => {
      drawHead(null, cue.text, local, head);
      cue.items.forEach((item, index) => {
        const place = places[index];
        const lit = springAt(local - pillAt(item, index), SPRING.snappy);
        drawStill(() => drawPill(item, place));
        if (lit <= 0) return;
        ctx.save();
        ctx.globalAlpha *= riseAlpha(lit);
        drawStill(() => drawPill(item, place, lit));
        ctx.restore();
      });
    },
    hasGold ? {} : cardAccent(local),
  );
};
SFX_OF.pills = (cue, duration) =>
  cardSfx(
    duration,
    cue.items.map((item, index) => ({ at: pillAt(item, index) + 0.05, sound: item.tone === "gold" ? "nodeGold" : "tick", pan: tickPan(index) })),
  );
