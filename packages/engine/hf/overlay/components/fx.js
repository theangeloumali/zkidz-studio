// Created by The Angelo Umali.
// Full-frame and comic effects: the cutaway, BAM bursts, camera flash and the shaky-vs-calm word pair.

// Full-frame cover for shaky camera moves while the voice continues. Opaque for its whole span (`cue.cover` edited
// seconds), then it wipes out to the right over the footage after it: timemap.js adds cutawayWipeOut to its window, since
// a wipe inside the span uncovered the tail of the move (measured on every v5 cutaway). `sub` is the kicker.
const CUTAWAY_WIPE_OUT = { card: 0.25, wipe: 0.2 };
// Under this many covered seconds a title can't finish rising, so it is a bare branded wipe.
const CUTAWAY_BARE_UNDER = 0.5;
const isBareCutaway = (cover) => cover < CUTAWAY_BARE_UNDER;
const cutawayStyle = (cue, cover) => (cue.style === "wipe" || isBareCutaway(cover) ? "wipe" : "card");
const cutawayWipeOut = (cue, cover) => CUTAWAY_WIPE_OUT[cutawayStyle(cue, cover)];

// "card": warm paper with BRAND.line hatching, the woven Z drawing on, kicker, serif title and a gold rule, centred in
// the safe band (below y 880 the title stays inside the button column). Places and beats in page space:
const CUTAWAY_CARD = { markTop: 520, markHeight: 220, markAt: 0.05, kicker: 830, kickerAt: 0.3, title: 940, titleAt: 0.4, rule: 980, ruleAt: 0.75 };

// The card cutaway's ground: warm paper with BRAND.line hatching.
function drawCardGround() {
  ctx.fillStyle = BRAND.paper;
  ctx.fillRect(0, 0, PW, PH);
  drawStill(() => hatch(() => ctx.rect(0, 0, PW, PH), { x: 0, y: 0, w: PW, h: PH }, { gap: 46, color: BRAND.line, width: 3, alpha: 1 }));
}

// 8 px each side for serif ink past the advance width (a final "Y" reached x 941).
function cutawayTitleFont(title) {
  const font = { ...TYPE.display, size: 108 };
  font.size = fitFontSize(title, font, 2 * (SAFE.columnRight - PW / 2 - 8));
  return font;
}

function drawCardCutaway(cue, local) {
  const { markTop, markHeight, markAt, kicker: kickerY, kickerAt, title, titleAt, rule, ruleAt } = CUTAWAY_CARD;
  drawCardGround();
  drawBrandZ(PW / 2 - zMarkWidth(markHeight) / 2, markTop, markHeight, brandZTiming(local, markAt));
  if (cue.sub) centredKicker(cue.sub, PW / 2, kickerY, local, kickerAt);
  const titleWidth = wordsRise(cue.title, PW / 2, title, cutawayTitleFont(cue.title), local, titleAt, { align: "center" });
  goldRule(PW / 2 - titleWidth / 2, rule, titleWidth, springAt(local - ruleAt));
}

// "wipe" (camera moves under 1.5 s): steel and gold twin diagonals (the Z's pair) scroll over ink behind a label
// plate. Repeating dashes cover the frame from its first frame with no wrap seam.
const WEAVE = { direction: [-0.5667, 0.8242], spacing: 300, twin: 70, reach: 1150, dash: 700, period: 1200, speed: 500 };

function drawWeave(local) {
  const [dirX, dirY] = WEAVE.direction;
  const [normalX, normalY] = [-dirY, dirX];
  for (let lane = -3; lane <= 3; lane++) {
    [
      [BRAND.steel, lane * WEAVE.spacing, 1],
      [BRAND.goldBright, lane * WEAVE.spacing + WEAVE.twin, -1],
    ].forEach(([color, offset, heading]) => {
      const at = (along) => [PW / 2 + normalX * offset + dirX * along, PH / 2 + normalY * offset + dirY * along];
      const shift = (((lane * 0.37 * WEAVE.period + heading * local * WEAVE.speed) % WEAVE.period) + WEAVE.period) % WEAVE.period;
      for (let tail = shift - WEAVE.reach - WEAVE.period; tail < WEAVE.reach; tail += WEAVE.period) {
        const [from, to] = heading > 0 ? [tail, tail + WEAVE.dash] : [tail + WEAVE.dash, tail];
        sketchLine(...at(from), ...at(to), { color, width: 30, passes: 1, rough: 1, overshoot: 0 });
        nodeRing(...at(to), 26, { color, surface: BRAND.ink });
      }
    });
  }
}

// Wipe cutaway places (page space): the label plate's top and height, the kicker and title baselines, the title beat.
const CUTAWAY_WIPE = { plateTop: 780, plateHeight: 240, kicker: 858, title: 968, titleAt: 0.06, step: 0.06 };

// The wipe cutaway's ground: ink with the twin diagonals at `local`.
function drawWipeGround(local) {
  ctx.fillStyle = BRAND.ink;
  ctx.fillRect(0, 0, PW, PH);
  drawWeave(local);
}

function wipeLayout(cue) {
  const titleFont = { ...TYPE.display, size: 96 };
  titleFont.size = fitFontSize(cue.title ?? "", titleFont, 760);
  return { titleFont, plateWidth: Math.max(textWidth(cue.title ?? "", titleFont), cue.sub ? kickerWidth(cue.sub) : 0) + 120 };
}

const drawWipePlate = (plateWidth) =>
  sketchRect(PW / 2 - plateWidth / 2, CUTAWAY_WIPE.plateTop, plateWidth, CUTAWAY_WIPE.plateHeight, {
    fill: BRAND.ink,
    color: BRAND.lineStrong,
    width: 3,
    passes: 1,
    rough: 1,
    overshoot: 0,
  });

function drawWipeCutaway(cue, local) {
  drawWipeGround(local);
  if (!cue.title && !cue.sub) return;
  const { titleFont, plateWidth } = wipeLayout(cue);
  drawStill(() => drawWipePlate(plateWidth));
  if (cue.sub) centredKicker(cue.sub, PW / 2, CUTAWAY_WIPE.kicker, local, 0, { color: BRAND.goldBright });
  if (cue.title)
    wordsRise(cue.title, PW / 2, CUTAWAY_WIPE.title, titleFont, local, CUTAWAY_WIPE.titleAt, {
      align: "center",
      color: BRAND.copyOnInk,
      step: CUTAWAY_WIPE.step,
    });
}

COMPONENTS.cutaway = (cue, env) => {
  const { local, duration } = env;
  const { cover } = cue;
  // No wipe-out when the video ends before it (timemap.js clamps the window to the edit).
  const wipeOut = duration > cover ? ease.in(span(local, cover, duration)) : 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(PW * wipeOut, 0, PW * (1 - wipeOut), PH);
  ctx.clip();
  if (cutawayStyle(cue, cover) === "card") drawCardCutaway(cue, local);
  else drawWipeCutaway(isBareCutaway(cover) ? {} : cue, local);
  ctx.restore();
  if (wipeOut > 0) wipeEdge(PW * wipeOut, 0, PH);
};

// swishOut peaks at -36 on its own; +2 dB lifts it to the cutaway's -34.
SFX_OF.cutaway = (cue) => [{ at: cue.cover, sound: "swishOut", gain: 2 }];

// Bursts alternate ink-with-gold-edge and gold-with-ink-edge (spec §1.3), popping on the snappy spring. One row in the
// top band (y ~275-615 with the pop's overshoot) keeps them off his head on face-cam; `dy` shifts the row and `text`.
const BAM_STEP = 0.35;
const BAM_RADIUS = 135;
const BAM_TEXT_Y = 690;
const BAM_SPOTS = [
  [256, 425, -0.12], // at 240 the pop's overshoot crossed SAFE.left by up to 13 px (QC r5)
  [825, 420, 0.1], // at 840 the pop's overshoot crossed SAFE.right by 14 px
  [540, 460, -0.04],
];
const BAM_TONES = [
  { fill: BRAND.ink, edge: BRAND.goldBright },
  { fill: BRAND.goldBright, edge: BRAND.ink },
];

COMPONENTS.bamBurst = (cue, env) => {
  const { local } = env;
  const dy = cue.dy ?? 0;
  ctx.globalAlpha *= exitAlpha(env);
  cue.words.forEach((word, index) => {
    const [x, y, rot] = BAM_SPOTS[index % BAM_SPOTS.length];
    const start = index * BAM_STEP;
    const pop = springAt(local - start, SPRING.snappy);
    if (pop <= 0) return;
    const shake = Math.sin((local + index) * 50) * 4 * (1 - span(local, start, start + 0.6));
    const tone = BAM_TONES[index % BAM_TONES.length];
    ctx.save();
    ctx.globalAlpha *= riseAlpha(pop);
    drawScaled(x + shake, y + dy, lerp(0.3, 1, pop), () => {
      ctx.rotate(rot);
      starBurst(BAM_RADIUS, 11, tone.fill, { edge: tone.edge });
      const wordFont = { ...TYPE.display, size: 92 };
      wordFont.size = fitFontSize(word, wordFont, BAM_RADIUS * 2);
      strokedText(word, 0, BAM_RADIUS * 0.2, wordFont, { align: "center", outline: 12 });
    });
    ctx.restore();
  });
  if (cue.text) {
    strokedText(cue.text, PW / 2, BAM_TEXT_Y + dy, { ...TYPE.hand, size: 84 }, { align: "center", fill: BRAND.goldBright, reveal: span(local, 1.1, 1.6) });
  }
};

SFX_OF.bamBurst = (cue) => cue.words.map((word, index) => ({ at: index * BAM_STEP, sound: "thud" }));

// White flash like a phone screenshot, with a shutter tick.
COMPONENTS.cameraFlash = (cue, env) => {
  ctx.globalAlpha = 0.85 * (1 - ease.out(span(env.local, 0, 0.45)));
  ctx.fillStyle = BRAND.white;
  ctx.fillRect(0, 0, PW, PH);
};

SFX_OF.cameraFlash = () => [{ at: 0, sound: "tick" }];

// Two words that behave like their meaning: one jitters with motion lines, one floats on waves.
// Stacked, not side by side: both words at 104 px would overflow a 1080-wide frame.
COMPONENTS.wordPair = (cue, env) => {
  const { local } = env;
  const font = { ...TYPE.display, size: 104 };
  const top = cue.y ?? 420;
  withMotion(PW / 2, top, env, () => {
    const total = textWidth(cue.left.text, font);
    let cursor = -total / 2;
    [...cue.left.text].forEach((letter) => {
      const rand = mulberry32(boilStep * 97 + letter.charCodeAt(0) + cursor);
      strokedText(letter, cursor + (rand() - 0.5) * 16, (rand() - 0.5) * 22, font, { fill: cue.left.color ?? BRAND.paper, rot: (rand() - 0.5) * 0.3 });
      cursor += textWidth(letter, font);
    });
    [-1, 1].forEach((side) =>
      outlinedStroke((color, grow) => sketchLine(side * (total / 2 + 30), -60, side * (total / 2 + 80), -90, { color, width: 6 + grow, passes: 1 }), {
        grow: 6,
      }),
    );
  });
  const rightAt = cue.rightAt ?? 0.5;
  withMotion(
    PW / 2,
    top + 210 + Math.sin(local * 2) * 10,
    env,
    () => {
      strokedText(cue.right.text, 0, 0, font, { align: "center", fill: cue.right.color ?? BRAND.paper });
      for (let row = 0; row < 2; row++) {
        const wave = [];
        for (let i = 0; i <= 20; i++) wave.push([-200 + i * 20, 50 + row * 30 + Math.sin(i * 0.8 + local * 3 + row) * 8]);
        outlinedStroke((color, grow) => sketchPath(wave, { color, width: 5 + grow, passes: 1 }), { grow: 6 });
      }
    },
    { start: rightAt },
  );
};

SFX_OF.wordPair = (cue, duration) => cardSfx(duration, [{ at: (cue.rightAt ?? 0.5) - SWISH_LEAD, sound: "swish" }]);
