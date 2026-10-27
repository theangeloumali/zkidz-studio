// Created by The Angelo Umali.
// Diagrams (canvas diagrams.js): the versus pair, a prompt splitting into two outcomes, and the three-station pipeline,
// each in its canvas layout with the brand effects on top.
const { rise, exit, pop } = require("../fx/motion");
const { slam, burst } = require("../fx/impact");
const { unit } = require("../brand/html");
const { k, drawn, join, idOf, SETTLED, card, panelCard, rising, arrow, written } = require("./parts");

// A team card (canvas teamBox): its lines rise out of a blur from `linesAt`, its sub under them. Flies in from its own
// side; only the left card brings the scrim.
function teamCard(cue, name, rect, side, { at, linesAt, inset = 34, index, duration }) {
  const [, , w, h] = rect;
  const lines = rising(cue, `${name}-line`, (s) => s.teamLines(side, 0, 0, inset, SETTLED, 0), linesAt, { step: 1 / 3, distance: 24 });
  const sub = side.sub ? drawn(cue, `${name}-sub`, (s) => s.drawTeamSub(side, 0, 0, w, h)) : "";
  return card(
    cue,
    name,
    rect,
    { html: lines.html + sub, motion: lines.motion },
    { tone: side.tone ?? "white", at, duration, style: index ? "flyRight" : "flyLeft", dim: index ? 0 : 0.55 },
  );
}

// Versus pair: two cards lift a third of a second apart; the VS badge slams in between them with a burst of gold.
const vsCard = {
  render(cue, { duration }) {
    const { VS } = k;
    const top = k.cardTop(cue);
    const [w, h] = VS.box;
    const sides = VS.sides.map(([x, start, inset], index) =>
      teamCard(cue, `side${index}`, [x, top, w, h], index ? cue.right : cue.left, { at: start, linesAt: start + VS.lines, inset, index, duration }),
    );
    const badgeAt = [VS.badge.x, top + VS.badge.dy];
    const contact = 0.16;
    const sparks = burst("vs-spark", cue.seed, badgeAt, VS.badge.at + contact, {
      count: 20,
      colour: k.BRAND.goldBright,
      reach: [80, 200],
      size: [4, 9],
      idPrefix: idOf(cue, "vs-spark"),
    });
    const pair = join(...sides, sparks);
    return {
      html: pair.html + drawn(cue, "badge", (s) => s.drawScaled(...badgeAt, 1, s.drawVsBadge), badgeAt),
      motion: [...pair.motion, ...slam(".badge", VS.badge.at, contact, { from: 2.2, blur: 6 })],
      exit: [...sides.flatMap((side) => side.exit), ...exit(".badge", duration)],
    };
  },
};

// Split flow: the prompt chip pops, two outlined arrows draw down to the outcomes, which fly in from their sides.
const splitFlow = {
  render(cue, { duration }) {
    const { SPLIT } = k;
    const top = k.cardTop(cue);
    const promptWidth = k.chipWidth(cue.text);
    const promptY = top + SPLIT.promptY;
    const prompt = drawn(
      cue,
      "prompt",
      (s) => s.drawScaled(540 - promptWidth / 2, promptY - k.CHIP_HEIGHT / 2, 1, () => s.drawChip(0, 0, cue.text, k.HOT_CHIP)),
      [540, promptY],
    );
    const arrows = SPLIT.arrows.map(([, , window], index) => arrow(cue, `arrow${index}`, (s, progress) => s.drawSplitArrow(index, top, progress), window));
    const { y, size, linesAfter, textSize } = SPLIT.box;
    const sides = SPLIT.boxes.map(([x, at], index) =>
      teamCard(
        cue,
        `side${index}`,
        [x, top + y, ...size],
        { ...(index ? cue.right : cue.left), size: textSize },
        { at, linesAt: at + linesAfter, index, duration },
      ),
    );
    // The chip and arrows sit on the footage and leave together; each outcome card makes its own exit.
    const flow = join(...arrows);
    const outcomes = join(...sides);
    return {
      html: unit("flow", "", [540, top + 120], prompt + flow.html) + outcomes.html,
      motion: [...rise(".prompt", 0, { preset: "snappy", distance: 16, scaleFrom: 0.85, blur: 6 }), ...flow.motion, ...outcomes.motion],
      exit: [...exit(".flow", duration), ...sides.flatMap((side) => side.exit)],
    };
  },
};

// Pipeline: three stations rise in turn on an accent card (speech bubble, the crew, the rocket); arrows draw between them
// as each next one lands, and each label writes on under its station. The crew and rocket hold one pose.
const pipeline = {
  render(cue, { duration }) {
    const { PIPELINE } = k;
    const { ask, linkY, labels } = PIPELINE;
    const station = (index, draw) => {
      const [x, y] = PIPELINE.stations[index];
      return {
        html: drawn(cue, `station${index}`, (s) => s.drawScaled(x, y, 1, () => draw(s)), [x, y]),
        motion: rise(`.station${index}`, k.pipelineStationAt(index), { preset: "snappy", distance: 24, scaleFrom: 0.85 }),
      };
    };
    const stations = [
      station(0, (s) => {
        s.drawSpeechBubble(...PIPELINE.bubble);
        s.drawText(ask.text, 0, ask.y, { ...k.TYPE.hand, size: ask.size, align: "center", wobble: 0.6 });
      }),
      station(1, (s) => s.drawPipelineTeam()),
      // The kit rocket's accent and sky parts take steel and gold.
      station(2, (s) => s.withKitColors({ accent: k.BRAND.steel, sky: k.BRAND.gold }, () => s.drawRocket(...PIPELINE.rocket, 0.75))),
    ];
    const links = PIPELINE.links.map(([fromX, toX, at], index) =>
      join(
        {
          html: drawn(cue, `node${index}`, (s) => s.nodeRing(fromX, linkY, 9, { surface: k.BRAND.paper }), [fromX, linkY]),
          motion: [pop(`.node${index}`, at - 0.1)],
        },
        arrow(cue, `link${index}`, (s, progress) => s.drawArrow(fromX + 14, linkY, toX, linkY, { progress, width: 6, head: 22, bend: 0 }), [at, at + 0.3]),
      ),
    );
    const font = { ...k.TYPE.hand, size: labels.size };
    const stationLabels = cue.labels.map((label, index) =>
      written(cue, `label${index}`, label, labels.x + index * labels.step, labels.y, font, k.penSpan(label, k.pipelineStationAt(index) + 0.2), {
        plain: true,
        align: "center",
        maxWidth: labels.maxWidth,
        wobble: 0.6,
      }),
    );
    return panelCard(cue, k.cardTop(cue), PIPELINE.height, join(...stations, ...links, ...stationLabels), { accent: true, duration });
  },
};

module.exports = { vsCard, splitFlow, pipeline };
