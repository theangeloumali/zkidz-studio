// Created by The Angelo Umali.
// Row cards that tick in on the spoken word: the checklist, the numbered criteria card and the flow row.
// Row `at`s are source seconds after the cue's `at`; timemap.js maps them onto the edit. Loads after brand-parts.js.

// Row text keeps its size on a phone: a row too long for its width wraps, and only that row grows by `lineGap`.
// Middles and `bottom` are in card space, rows starting at `top`.
function rowStack(texts, font, width, { top, rowHeight, lineGap }) {
  let y = top;
  const rows = texts.map((text) => {
    const lines = wrapLines(text, font, width);
    const height = rowHeight + (lines.length - 1) * lineGap;
    const row = { lines, middle: y + height / 2 };
    y += height;
    return row;
  });
  return { rows, bottom: y };
}

// Each wrapped line of a row, centred on its middle (card space).
function rowText({ lines, middle }, x, font, lineGap, rise, options) {
  const firstBaseline = middle + font.size * 0.36 - ((lines.length - 1) * lineGap) / 2;
  lines.forEach((line, index) => riseText(line, x, firstBaseline + index * lineGap, font, rise, options));
}

// Checklist: a steel check or a negative cross draws on as each row rises.
const CHECKLIST = {
  rowsTop: 133,
  rowHeight: 86,
  lineGap: 50,
  textX: 150,
  textWidth: 780,
  font: { ...TYPE.label, size: 44 },
  draw: 0.25,
  title: [50, 88],
  markX: 90,
  check: 50,
  cross: 42,
};
const checklistRowAt = (row, index) => row.at ?? 0.4 + index * 0.45;

// Title font and row stack (card space); hf/components/lists.js lays its checklist out with this too.
function checklistLayout(cue) {
  const titleFont = { ...TYPE.display, size: 60 };
  titleFont.size = fitFontSize(cue.text, titleFont, 860);
  const stack = rowStack(
    cue.rows.map((row) => row.text),
    CHECKLIST.font,
    CHECKLIST.textWidth,
    { top: CHECKLIST.rowsTop, rowHeight: CHECKLIST.rowHeight, lineGap: CHECKLIST.lineGap },
  );
  return { titleFont, stack, height: stack.bottom + 7 };
}

COMPONENTS.checklist = (cue, env) => {
  const { local } = env;
  const { font, lineGap } = CHECKLIST;
  const { titleFont, stack, height } = checklistLayout(cue);
  panelCard(
    env,
    cardTop(cue),
    height,
    () => {
      wordsRise(cue.text, ...CHECKLIST.title, titleFont, local, 0.15);
      cue.rows.forEach((row, index) => {
        const at = checklistRowAt(row, index);
        const { middle } = stack.rows[index];
        const mark = span(local, at, at + CHECKLIST.draw);
        if (row.ok) drawCheck(CHECKLIST.markX, middle, CHECKLIST.check, { progress: mark, color: BRAND.steel });
        else drawCross(CHECKLIST.markX, middle, CHECKLIST.cross, { progress: mark });
        rowText(stack.rows[index], CHECKLIST.textX, font, lineGap, riseIn(local, at, { distance: 18 }), { color: row.color ?? BRAND.ink });
      });
    },
    cardAccent(local),
  );
};

SFX_OF.checklist = (cue, duration) =>
  cardSfx(
    duration,
    cue.rows.map((row, index) => ({ at: checklistRowAt(row, index) + CHECKLIST.draw, sound: row.ok ? "check" : "tick" })),
  );

// Criteria card: numbered rows that light and rise on their spoken word, each ticked in steel 0.25 s later.
// Four or more rows pack tighter so the card still clears the face on face-cam.
const CRITERIA = {
  balloon: 26,
  check: 0.25,
  lineGap: 50,
  font: { ...TYPE.body, size: 44 },
  unlit: { color: BRAND.muted },
  lit: { color: BRAND.paper, fill: BRAND.ink },
};
const criteriaRowHeight = (cue) => (cue.rows.length > 3 ? 74 : 84);

// The balloon, text and tick columns, the row stack and the card height (card space).
function criteriaLayout(cue) {
  const head = headLayout(cue.kicker, cue.title);
  const textX = CARD_PAD + 2 * CRITERIA.balloon + 24;
  const checkX = PANEL_W - CARD_PAD - 22;
  const stack = rowStack(
    cue.rows.map((row) => row.text),
    CRITERIA.font,
    checkX - 50 - textX,
    { top: head.bottom + 22, rowHeight: criteriaRowHeight(cue), lineGap: CRITERIA.lineGap },
  );
  return { head, balloonX: CARD_PAD + CRITERIA.balloon, textX, checkX, stack, height: stack.bottom + 18 };
}

// A row's steel tick, drawn on to `progress`.
const drawCriteriaTick = (checkX, middle, progress) => drawCheck(checkX, middle, 40, { progress, color: BRAND.steel, width: 7 });

COMPONENTS.criteriaCard = (cue, env) => {
  const { local } = env;
  const { head, balloonX, textX, checkX, stack, height } = criteriaLayout(cue);
  const { font, lineGap } = CRITERIA;
  panelCard(
    env,
    cue.y,
    height,
    () => {
      drawHead(cue.kicker, cue.title, local, head);
      cue.rows.forEach((row, index) => {
        const at = criteriaAt(row, index);
        const { middle } = stack.rows[index];
        const rise = riseIn(local, at, { distance: 16, scaleFrom: 1 });
        const pop = springAt(local - at, SPRING.snappy);
        drawStill(() => {
          // Unlit balloons show what is coming; each lights to ink as its row lands, then covers the unlit ring.
          if (pop < 0.9) numberBalloon(index + 1, balloonX, middle, CRITERIA.balloon, 1, CRITERIA.unlit);
          numberBalloon(index + 1, balloonX, middle, CRITERIA.balloon, pop, CRITERIA.lit);
          rowText(stack.rows[index], textX, font, lineGap, rise);
        });
        const tick = span(local, at + CRITERIA.check, at + CRITERIA.check + 0.3);
        if (tick >= 1) drawStill(() => drawCriteriaTick(checkX, middle, tick));
        else if (tick > 0) drawCriteriaTick(checkX, middle, tick);
      });
    },
    cardAccent(local),
  );
};
SFX_OF.criteriaCard = (cue, duration) =>
  cardSfx(
    duration,
    cue.rows.map((row, index) => ({ at: criteriaAt(row, index) + CRITERIA.check, sound: "check", pan: tickPan(index) })),
  );

// Flow row: boxes joined by arrows with node-ring tails, revealed in order; the last box is the ink highlight.
// An item shrinks to fit its box down to `itemMin`, then wraps onto a second line instead.
const FLOW = { gap: 70, height: 330, boxHeight: 140, rowY: 205, item: 38, itemMin: 36, lineGap: 42, edge: 3, lead: 0.2 };

function flowItemLines(item, boxW) {
  const font = { ...TYPE.label, size: FLOW.item };
  font.size = Math.max(FLOW.itemMin, fitFontSize(item, font, boxW - 24));
  return { font, lines: wrapLines(item, font, boxW - 24) };
}

// The box width and, per item, its box x, beat, tone and wrapped words (card space).
function flowLayout(cue) {
  const count = cue.items.length;
  const boxW = (900 - FLOW.gap * (count - 1)) / count;
  const items = cue.items.map((item, index) => {
    const { font, lines } = flowItemLines(item, boxW);
    const firstBaseline = font.size * 0.36 - ((lines.length - 1) * FLOW.lineGap) / 2;
    return { x: 30 + index * (boxW + FLOW.gap), at: flowItemAt(cue, index), tone: index === count - 1 ? "ink" : "white", font, lines, firstBaseline };
  });
  return { boxW, head: headLayout(null, cue.text), items };
}

// Into the box at `x`: its node-ring tail popped to `pop`, and its arrow drawn on to `progress` (card space).
const flowTail = (x, pop) => nodeRing(x - FLOW.gap + 12, FLOW.rowY, 9, { pop, surface: BRAND.paper });
const flowArrow = (x, progress) => drawArrow(x - FLOW.gap + 26, FLOW.rowY, x - 8, FLOW.rowY, { progress, width: 5, head: 16, bend: 0 });

// A box's words, centred on the box middle.
function drawFlowWords({ font, lines, firstBaseline, tone }, boxW) {
  const itemFont = { ...font, align: "center", maxWidth: boxW - 24, color: TONE_INK[tone], wobble: 0.2 };
  lines.forEach((line, lineIndex) => drawText(line, 0, firstBaseline + lineIndex * FLOW.lineGap, itemFont));
}

COMPONENTS.flowRow = (cue, env) => {
  const { local } = env;
  const { boxW, head, items } = flowLayout(cue);
  panelCard(
    env,
    cardTop(cue),
    FLOW.height,
    () => {
      drawHead(null, cue.text, local, head);
      items.forEach((item, index) => {
        const { x, at, tone } = item;
        if (index > 0) {
          flowTail(x, springAt(local - at + FLOW.lead, SPRING.snappy));
          flowArrow(x, span(local, at - FLOW.lead, at));
        }
        withMotion(
          x + boxW / 2,
          FLOW.rowY,
          riseOnly(env),
          () => {
            brandCard(-boxW / 2, -FLOW.boxHeight / 2, boxW, FLOW.boxHeight, { tone, width: FLOW.edge });
            drawFlowWords(item, boxW);
          },
          { start: at },
        );
      });
    },
    cardAccent(local),
  );
};

SFX_OF.flowRow = (cue, duration) =>
  cardSfx(
    duration,
    cue.items.map((item, index) => ({ at: flowItemAt(cue, index) + 0.05, sound: "tick", pan: tickPan(index) })),
  );
