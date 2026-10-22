// Created by The Angelo Umali.
// Diagram cards: versus, prompt split and pipeline (checklist and flow row are in rows.js).

const TONE_INK = { paper: BRAND.ink, white: BRAND.ink, ink: BRAND.copyOnInk };

// One contender: a white card (or `tone`), serif lines and a mono sub.
// `inset` pushes text right, clear of the VS badge that overlaps the right-hand box.
// A team card's serif lines rising from `start`, `inset` from its left edge.
function teamLines(side, x, y, inset, local, start) {
  const font = { ...TYPE.display, size: side.size ?? 70 };
  linesRise(side.text.split("\n"), x + inset, y + 110, font, font.size * 1.06, local, start, { color: TONE_INK[side.tone ?? "white"] });
}

// A team card's mono sub line along its bottom edge.
const drawTeamSub = (side, x, y, w, h) =>
  drawText(side.sub, x + 36, y + h - 34, {
    ...TYPE.mono,
    size: 34,
    color: side.tone === "ink" ? BRAND.mutedOnInk : BRAND.muted,
    maxWidth: w - 60,
    wobble: 0.2,
  });

function teamBox(x, y, w, h, side, local, start, inset = 34) {
  brandCard(x, y, w, h, { tone: side.tone ?? "white" });
  teamLines(side, x, y, inset, local, start);
  if (side.sub) drawTeamSub(side, x, y, w, h);
}

// Two cards rise in turn and a gold-ringed VS badge pops between them.
// Two cards (x, entrance start, text inset; their lines rise `lines` s later) and the VS badge low in the gap.
const VS = {
  box: [440, 330],
  sides: [
    [SAFE.left, 0, 34],
    [575, 1 / 3, 64],
  ],
  lines: 0.15,
  badge: { x: 540, dy: 250, at: 0.6 },
};
// The badge at its own origin; low in the gap, it never covers either title.
const drawVsBadge = () => ringBadge(0, 0, 62, "VS", { fill: BRAND.ink, ring: BRAND.goldBright, color: BRAND.goldBright });

COMPONENTS.vsCard = (cue, env) => {
  const { local } = env;
  const top = cardTop(cue);
  const [w, h] = VS.box;
  VS.sides.forEach(([x, start, inset], index) =>
    withMotion(x, top, env, () => teamBox(0, 0, w, h, index ? cue.right : cue.left, local, start + VS.lines, inset), { start }),
  );
  const badgePop = springAt(local - VS.badge.at, SPRING.snappy);
  if (badgePop <= 0) return;
  ctx.globalAlpha *= exitAlpha(env) * riseAlpha(badgePop);
  drawScaled(VS.badge.x, top + VS.badge.dy, badgePop, drawVsBadge);
};

SFX_OF.vsCard = (cue, duration) => cardSfx(duration, [{ at: VS.badge.at, sound: "tick" }]);

// A prompt chip splits into two outcomes, laid out below the cue's top (hf/components/diagrams.js reads this too):
// each arrow's x from and to, draw window and bend; each outcome card's x and entrance.
const SPLIT = {
  promptY: 40,
  arrows: [
    [470, 290, [0.35, 0.7], -0.15],
    [610, 790, [0.45, 0.8], 0.15],
  ],
  arrowY: [100, 205],
  boxes: [
    [SAFE.left, 0.6],
    [575, 0.75],
  ],
  box: { y: 210, size: [440, 190], linesAfter: 0.1, textSize: 50 },
};

function drawSplitArrow(index, top, progress) {
  const [fromX, toX, , bend] = SPLIT.arrows[index];
  const [fromY, toY] = SPLIT.arrowY;
  outlinedStroke((color, grow) => drawArrow(fromX, top + fromY, toX, top + toY, { progress, color, width: 8 + grow, head: 28, bend }));
}

COMPONENTS.splitFlow = (cue, env) => {
  const { local } = env;
  const top = cardTop(cue);
  const promptWidth = chipWidth(cue.text);
  withMotion(540, top + SPLIT.promptY, env, () => drawChip(-promptWidth / 2, -CHIP_HEIGHT / 2, cue.text, HOT_CHIP), {
    preset: SPRING.snappy,
    scaleFrom: 0.85,
    distance: 16,
  });
  ctx.save();
  ctx.globalAlpha *= exitAlpha(env);
  SPLIT.arrows.forEach(([, , window], index) => drawSplitArrow(index, top, span(local, ...window)));
  ctx.restore();
  const { y, size, linesAfter, textSize } = SPLIT.box;
  SPLIT.boxes.forEach(([x, at], index) =>
    withMotion(x, top + y, env, () => teamBox(0, 0, ...size, { ...(index ? cue.right : cue.left), size: textSize }, local, at + linesAfter), { start: at }),
  );
};

SFX_OF.splitFlow = (cue, duration) => [
  { at: 0.05, sound: "tick" },
  { at: SPLIT.boxes[0][1] - SWISH_LEAD, sound: "swish" },
  { at: duration - EXIT, sound: "swishOut" },
];

// Three stations joined by arrows: speech bubble, the team (three brand nodes), rocket.
const pipelineStationAt = (index) => 0.2 + index * 0.55;
// Card space, shared with hf/components/diagrams.js: the stations (bubble, crew, rocket), the arrows between them (x from
// and to, and when each draws; they stop short of the middle station's props) and the labels under them.
const PIPELINE = {
  height: 400,
  stations: [
    [160, 170],
    [480, 190],
    [800, 170],
  ],
  bubble: [-120, -95, 240, 170, -60, 120],
  ask: { text: "??", y: 18, size: 72 },
  rocket: [40, 0, -0.5, 0.5],
  links: [
    [270, 350, 0.6],
    [610, 690, 1.15],
  ],
  linkY: 170,
  labels: { x: 160, step: 320, y: 350, size: 50, maxWidth: 290 },
};
function drawPipelineTeam() {
  [-70, 0, 70].forEach((offset) => nodeRing(offset, 40, 26, { surface: BRAND.paper }));
}

COMPONENTS.pipeline = (cue, env) => {
  const { local } = env;
  const station = (index, draw) => withMotion(...PIPELINE.stations[index], riseOnly(env), draw, { start: pipelineStationAt(index) });
  const { ask, links, linkY, labels } = PIPELINE;
  panelCard(
    env,
    cardTop(cue),
    PIPELINE.height,
    () => {
      station(0, () => {
        drawStill(() => drawSpeechBubble(...PIPELINE.bubble));
        drawText(ask.text, 0, ask.y, { ...TYPE.hand, size: ask.size, align: "center", wobble: 0.6 });
      });
      station(1, () => drawPipelineTeam());
      // The kit rocket's accent and sky parts take steel and gold.
      station(2, () => withKitColors({ accent: BRAND.steel, sky: BRAND.gold }, () => drawRocket(...PIPELINE.rocket, Math.sin(local * 20) * 0.5 + 0.5)));
      links.forEach(([fromX, toX, at]) => {
        nodeRing(fromX, linkY, 9, { pop: springAt(local - at + 0.1, SPRING.snappy), surface: BRAND.paper });
        drawArrow(fromX + 14, linkY, toX, linkY, { progress: span(local, at, at + 0.3), width: 6, head: 22, bend: 0 });
      });
      cue.labels.forEach((label, index) =>
        drawText(label, labels.x + index * labels.step, labels.y, {
          ...TYPE.hand,
          size: labels.size,
          align: "center",
          maxWidth: labels.maxWidth,
          wobble: 0.6,
          reveal: span(local, ...penSpan(label, pipelineStationAt(index) + 0.2)),
        }),
      );
    },
    cardAccent(local),
  );
};

SFX_OF.pipeline = (cue, duration) => cardSfx(duration);
