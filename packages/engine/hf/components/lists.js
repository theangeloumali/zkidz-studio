// Created by The Angelo Umali.
// Cards of items that land on their words: the numbered criteria card and the checklist (rows.js), status pills
// (brand-flow.js) and skill chips (chips.js), each in its canvas layout with the brand effects on top.
const { unit, drawable } = require("../brand/html");
const { rise, pop, hide } = require("../fx/motion");
const { slideIn } = require("../fx/paper");
const { drawOn, flood } = require("../fx/ink");
const { burst } = require("../fx/impact");
const { k, still, drawn, join, NOTHING, idOf, SETTLED_RISE, panelCard, head, risingWords, written } = require("./parts");

// Criteria card: rows slide in on their words, each numbered circle floods with ink, a steel tick draws 0.25 s later.
const criteriaCard = {
  render(cue, { duration }) {
    const { CRITERIA } = k;
    const layout = k.criteriaLayout(cue);
    const { balloonX, textX, checkX, stack } = layout;
    const rows = cue.rows.map((row, index) => {
      const at = k.criteriaAt(row, index);
      const { middle } = stack.rows[index];
      const centre = [balloonX, middle];
      const name = `row${index}`;
      const balloon = (options) => (s) => s.numberBalloon(index + 1, ...centre, CRITERIA.balloon, 1, options);
      return {
        html:
          drawn(cue, `${name}-unlit`, balloon(CRITERIA.unlit), centre) +
          drawn(cue, `${name}-lit`, balloon(CRITERIA.lit), centre) +
          drawn(cue, `${name}-text`, (s) => s.rowText(stack.rows[index], textX, CRITERIA.font, CRITERIA.lineGap, SETTLED_RISE), [textX, middle]) +
          unit(`${name}-check`, drawable(still(cue, `${name}-check`, (s) => s.drawCriteriaTick(checkX, middle, 1))), [checkX, middle]),
        motion: [
          pop(`.${name}-lit`, at, "snappy", { from: 0.6 }),
          flood(`.${name}-lit`, at, centre, CRITERIA.balloon + 8),
          // The canvas stops drawing the unlit ring once the lit one is 0.9 popped; its wobble would show round the edge.
          hide(`.${name}-unlit`, at + 0.2),
          ...slideIn(`.${name}-text`, at),
          drawOn(`.${name}-check path`, at + CRITERIA.check, { duration: 0.3, ease: "power1.inOut" }),
        ],
      };
    });
    const content = join(head(cue, cue.kicker, cue.title, layout.head), ...rows);
    return panelCard(cue, cue.y, layout.height, content, { accent: true, duration });
  },
};

// Status pills: all start unlit; each lights on its word (snappy), and a gold one throws a few gold specks.
const pills = {
  render(cue, { duration }) {
    const { head: headLayout, places, height } = k.pillsLayout(cue);
    const items = cue.items.map((item, index) => {
      const place = places[index];
      const at = k.pillAt(item, index);
      const middle = [place.x + place.width / 2, place.y + k.PILL.height / 2];
      const sparks =
        item.tone === "gold"
          ? burst(`gold${index}`, cue.seed + index, [place.x + 30, middle[1]], at + 0.05, {
              count: 14,
              colour: k.BRAND.goldBright,
              reach: [40, 120],
              size: [3, 7],
              idPrefix: idOf(cue, `gold${index}`),
            })
          : NOTHING;
      return join(
        {
          html: drawn(cue, `pill${index}`, (s) => s.drawPill(item, place)) + drawn(cue, `lit${index}`, (s) => s.drawPill(item, place, 1), middle),
          motion: rise(`.lit${index}`, at, { preset: "snappy", distance: 0, scaleFrom: 0.94 }),
        },
        sparks,
      );
    });
    const content = join(head(cue, null, cue.text, headLayout), ...items);
    const hasGold = cue.items.some((item) => item.tone === "gold");
    return panelCard(cue, cue.y, height, content, { accent: !hasGold, duration });
  },
};

// Skill chips over the footage: an optional hand label writes on, then each chip slides in on its word with a skew that
// straightens; a note under a chip writes on after it.
const chips = {
  render(cue) {
    const { CHIP_NOTE } = k;
    const { label: place, slots } = k.chipsLayout(cue);
    const label = place ? written(cue, "label", cue.text, place.x, place.y, place.font, k.penSpan(cue.text, 0), { fill: cue.color ?? k.BRAND.paper }) : NOTHING;
    const items = slots.map(({ x, y, width }, index) => {
      const item = cue.items[index];
      const start = k.chipStartOf(cue, index);
      const centre = [x + width / 2, y + k.CHIP_HEIGHT / 2];
      const note = item.note
        ? written(
            cue,
            `note${index}`,
            item.note,
            x + CHIP_NOTE.dx,
            y + CHIP_NOTE.dy,
            { ...k.TYPE.hand, size: CHIP_NOTE.size },
            CHIP_NOTE.write.map((t) => start + t),
            {
              fill: k.BRAND.goldBright,
            },
          )
        : NOTHING;
      return join(
        {
          html: drawn(cue, `chip${index}`, (s) => s.drawScaled(...centre, 1, () => s.drawChipItem(item, width)), centre),
          motion: [...slideIn(`.chip${index}`, start, { preset: "snappy" }), pop(`.chip${index}`, start, "snappy", { from: 0.85 })],
        },
        note,
      );
    });
    return join(label, ...items);
  },
};

// Checklist: each row slides in on its word as a steel check (or a cross, stroke by stroke) draws on beside it.
const checklist = {
  render(cue, { duration }) {
    const { CHECKLIST } = k;
    const { titleFont, stack, height } = k.checklistLayout(cue);
    const rows = cue.rows.map((row, index) => {
      const at = k.checklistRowAt(row, index);
      const { middle } = stack.rows[index];
      const name = `row${index}`;
      const mark = row.ok
        ? (s) => s.drawCheck(CHECKLIST.markX, middle, CHECKLIST.check, { color: k.BRAND.steel })
        : (s) => s.drawCross(CHECKLIST.markX, middle, CHECKLIST.cross);
      // The cross is two strokes, each drawn in half the time, one after the other.
      const strokes = row.ok ? { duration: CHECKLIST.draw } : { duration: CHECKLIST.draw / 2, stagger: CHECKLIST.draw / 2 };
      const text = (s) => s.rowText(stack.rows[index], CHECKLIST.textX, CHECKLIST.font, CHECKLIST.lineGap, SETTLED_RISE, { color: row.color ?? k.BRAND.ink });
      return {
        html:
          unit(`${name}-mark`, drawable(still(cue, `${name}-mark`, mark)), [CHECKLIST.markX, middle]) +
          drawn(cue, `${name}-text`, text, [CHECKLIST.textX, middle]),
        motion: [drawOn(`.${name}-mark path`, at, { ...strokes, ease: "power1.inOut" }), ...slideIn(`.${name}-text`, at)],
      };
    });
    const content = join(risingWords(cue, "title", cue.text, ...CHECKLIST.title, titleFont, 0.15), ...rows);
    return panelCard(cue, k.cardTop(cue), height, content, { accent: true, duration });
  },
};

module.exports = { criteriaCard, pills, chips, checklist };
