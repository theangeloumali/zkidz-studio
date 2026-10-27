// Created by The Angelo Umali.
// Small labels: handwritten notes, stamps, the censor burst and the "now playing" badge.
// It loads first of the restyled component files, so the brand helpers they share live at its top.

// A card's gold accent rule draws on along its top edge from 0.15 s (spec §3.3 rule 9).
const cardAccent = (local) => ({ accent: springAt(local - 0.15) });
// For withMotion nested inside a card that already exits: the card owns the exit, so this one's never starts.
// Finite on purpose: an Infinity duration makes exitOut's span NaN, and canvas silently ignores NaN transforms.
const riseOnly = (env) => ({ local: env.local, duration: 1e9 });
const exitAlpha = (env) => exitOut(env).alpha;
// Swish ends at the card's rise t50; swishOut starts with its exit (spec §6.2).
const SWISH_LEAD = 0.06;
const cardSfx = (duration, events = []) => [{ at: -SWISH_LEAD, sound: "swish" }, ...events, { at: duration - EXIT, sound: "swishOut" }];
// Pen timing for Caveat (spec §2.4): about 0.025 s per character after a 0.25 s lead.
const penSpan = (text, start) => [start, start + 0.25 + text.length * 0.025];
const HOT_CHIP = themed(() => ({ fill: BRAND.ink, color: BRAND.goldBright, edge: BRAND.ink }));

// Seconds until `preset` first reaches `threshold`: where countUp lands, and its settle SFX with it.
function settleTime(preset, threshold = 0.99) {
  let seconds = 0;
  while (springAt(seconds, preset) < threshold) seconds += 1 / 120;
  return seconds;
}

// Strokes straight on footage, treated like footage text: a fill stroke over a wider outline with the same wobble.
function outlinedStroke(draw, { fill = BRAND.paper, outline = BRAND.ink, grow = 8 } = {}) {
  sameSeed(
    [
      { color: outline, grow },
      { color: fill, grow: 0 },
    ],
    (layer) => draw(layer.color, layer.grow),
  );
}

// Round badge (chip tags, the VS mark): a filled disc in a gold ring with a short label.
function ringBadge(x, y, radius, text, { fill = BRAND.white, ring = BRAND.gold, color = BRAND.ink } = {}) {
  sketchEllipse(x, y, radius, radius, { fill, color: ring, width: Math.max(4, radius * 0.16), passes: 1, rough: 0.6 });
  drawText(text, x, y + radius * 0.36, { ...TYPE.label, size: radius * 1.05, weight: 700, color, align: "center", wobble: 0.2 });
}

// kicker() draws from its left edge and returns its width; before its start it draws nothing, so this only measures.
const kickerWidth = (text, options = {}) => kicker(text, 0, 0, -1, 0, options);
const centredKicker = (text, centreX, y, local, start, options = {}) => kicker(text, centreX - kickerWidth(text, options) / 2, y, local, start, options);

// Handwritten note on the footage (Caveat writes on), optionally striking an old phrase and pointing an arrow.
const HAND_STRIKE = [0.35, 0.8];
const HAND_ARROW = [0.5, 0.95];
const handLineSpans = (cue) => cue.text.split("\n").map((line, index) => penSpan(line, (cue.strike ? 0.9 : 0.05) + index * 0.35));

function handNoteLayout(cue) {
  const font = { ...TYPE.hand, size: cue.size ?? 72 };
  return { x: cue.x ?? PW / 2, y: cue.y, align: cue.align ?? "center", rot: cue.rot ?? -0.04, font, lines: cue.text.split("\n"), lineGap: font.size * 1.05 };
}

// The struck phrase above the note, in note space; `progress` draws the negative strike across it.
function drawHandStrike(cue, { font, align, rot }, progress) {
  strokedText(cue.strike, 0, -font.size * 1.15, font, { align, rot });
  const width = textWidth(cue.strike, font);
  const left = align === "center" ? -width / 2 : 0;
  const y = -font.size * 1.45;
  if (progress > 0)
    outlinedStroke((color, grow) => sketchLine(left - 10, y, lerp(left - 10, left + width + 10, progress), y + 6, { color, width: 10 + grow, passes: 1 }), {
      fill: BRAND.negative,
      grow: 7,
    });
}

// The note's arrow (page coordinates in the cue) in note space, drawn on to `progress`.
function drawHandArrow(cue, { x, y }, progress) {
  const [fromX, fromY, toX, toY] = cue.arrow;
  outlinedStroke((color, grow) => drawArrow(fromX - x, fromY - y, toX - x, toY - y, { progress, color, width: 9 + grow, head: 34, bend: 0.25 }));
}

COMPONENTS.handNote = (cue, env) => {
  const { local } = env;
  const layout = handNoteLayout(cue);
  const { font, align, rot, lines, lineGap } = layout;
  withMotion(
    layout.x,
    layout.y,
    env,
    () => {
      if (cue.strike) drawHandStrike(cue, layout, span(local, ...HAND_STRIKE));
      handLineSpans(cue).forEach(([start, end], index) => strokedText(lines[index], 0, index * lineGap, font, { align, rot, reveal: span(local, start, end) }));
      if (cue.arrow) drawHandArrow(cue, layout, span(local, ...HAND_ARROW));
    },
    { distance: 0, scaleFrom: 1 },
  );
};

SFX_OF.handNote = (cue) => {
  const spans = handLineSpans(cue);
  const pencil = { at: spans[0][0], sound: "pencil", dur: spans.at(-1)[1] - spans[0][0] };
  const scratch = { at: HAND_STRIKE[0], sound: "scratch", dur: HAND_STRIKE[1] - HAND_STRIKE[0] };
  return cue.strike ? [scratch, pencil] : [pencil];
};

// Rubber stamp that slams down from 1.8x and settles with a gold impact burst; the thud lands at contact.
const SLAM_CONTACT = 0.18;
const STAMP_SUB_MIN = 36;

// The settled, rotated box fits the safe columns around (x, y): an over-long stamp shrinks, but its sub never goes
// under STAMP_SUB_MIN. Default proportions: sub 0.3 x size, box 1.35 x size tall plus 4/3 of the sub.
function stampLayout(cue) {
  const tilt = Math.abs(cue.rot ?? -0.08);
  const room = 2 * Math.min(cue.x - SAFE.left, safeRight(cue.y) - cue.x);
  const measure = (size) => {
    const font = { ...TYPE.display, size };
    const subFont = { ...TYPE.label, size: Math.max(STAMP_SUB_MIN, size * 0.3) };
    const boxW = Math.max(textWidth(cue.text, font), cue.sub ? textWidth(cue.sub, subFont) : 0) + size * 0.8;
    const boxH = size * 1.35 + (cue.sub ? (subFont.size * 4) / 3 : 0);
    return { size, font, subFont, boxW, boxH, extent: boxW * Math.cos(tilt) + boxH * Math.sin(tilt) };
  };
  const asked = measure(cue.size ?? 110);
  return asked.extent <= room ? asked : measure((asked.size * room) / asked.extent);
}

// The stamp face at its own origin (the caller rotates and scales): shadow, white box, double rule in `color`, title, sub.
function drawStampFace(cue, { size, font, subFont, boxW, boxH }, color) {
  drawStill(() => {
    dropShadow(rectPoints(-boxW / 2, -boxH / 2, boxW, boxH));
    sketchRect(-boxW / 2, -boxH / 2, boxW, boxH, { fill: BRAND.white, color, width: 9, passes: 1, overshoot: 0 });
    sketchRect(-boxW / 2 + 14, -boxH / 2 + 14, boxW - 28, boxH - 28, { color, width: 3.5, passes: 1, overshoot: 0 });
  });
  // Baselines: the title 0.825 x size under the box top, the sub 0.85 x its own size over the bottom.
  drawText(cue.text, 0, cue.sub ? -boxH / 2 + 0.825 * size : 0.35 * size, { ...font, color, align: "center", wobble: 0.2 });
  if (cue.sub) drawText(cue.sub, 0, boxH / 2 - 0.85 * subFont.size, { ...subFont, color: BRAND.ink, align: "center", wobble: 0.2 });
}

// The gold impact burst: spokes from 0.55 box widths out, `grown` (0-1) of the way to 70 px beyond.
function drawStampBurst(x, y, boxW, grown) {
  const inner = boxW * 0.55;
  outlinedStroke((burstColor, grow) => drawBurst(x, y, inner, inner + 70 * grown, 14, { color: burstColor, width: 5 + grow }), {
    fill: BRAND.goldBright,
    grow: 6,
  });
}

// After contact the stamp settles with a 3 % wobble.
const stampSettle = (seconds) => 1 + 0.03 * Math.sin(seconds * 30) * Math.exp(-seconds * 10);

COMPONENTS.slamStamp = (cue, env) => {
  const { local } = env;
  const layout = stampLayout(cue);
  const settle = local - SLAM_CONTACT;
  const slam = settle < 0 ? lerp(1.8, 1, ease.in(local / SLAM_CONTACT)) : stampSettle(settle);
  const exit = exitOut(env);
  ctx.save();
  ctx.translate(cue.x, cue.y + exit.dy);
  ctx.rotate(cue.rot ?? -0.08);
  ctx.scale(slam * exit.scale, slam * exit.scale);
  ctx.globalAlpha *= span(local, 0, 0.06) * exit.alpha;
  drawStampFace(cue, layout, cue.color ?? TEAM.bad);
  ctx.restore();
  if (local > SLAM_CONTACT - 0.02 && local < 0.5) drawStampBurst(cue.x, cue.y, layout.boxW, span(local, SLAM_CONTACT - 0.02, 0.5));
};

SFX_OF.slamStamp = () => [{ at: SLAM_CONTACT, sound: "thud" }];

// Censor gag over a bleeped word (spec §5.9) at its own origin: ink burst with a goldBright edge, mask, bleep note.
function drawCensorGag() {
  starBurst(160, 12, BRAND.ink, { inner: 105 / 160, stretch: 1.35, edge: BRAND.goldBright });
  strokedText("#!@%", 0, 28, { ...TYPE.display, size: 92 }, { align: "center", outline: 10 });
  strokedText("*bleep*", 0, 150, { ...TYPE.hand, size: 50 }, { align: "center", fill: BRAND.goldBright });
}
const CENSOR_SHAKE = { amplitude: 4, rate: 60 }; // px, rad/s

// It pops on the elastic spring and shakes the whole time.
COMPONENTS.censor = (cue, env) => {
  const shake = Math.sin(env.local * CENSOR_SHAKE.rate) * CENSOR_SHAKE.amplitude;
  withMotion(cue.x + shake, cue.y, env, drawCensorGag, { preset: SPRING.elastic, scaleFrom: 0.3, distance: 0 });
};

// Silent on purpose: the bleep itself is the joke (spec §6.2).
SFX_OF.censor = () => [];

// Top-left ink tab while a film plays on the monitor.
COMPONENTS.nowPlaying = (cue, env) => {
  const font = { ...TYPE.label, size: 38 };
  const subFont = { ...TYPE.mono, size: 30 };
  const width = Math.max(textWidth(cue.text, font), textWidth(cue.sub ?? "", subFont)) + 150;
  withMotion(SAFE.left, SAFE.top + 20, env, () => {
    brandCard(0, 0, width, 124, { tone: "ink" });
    const beat = pulse(env.local, { period: 1, min: 0.75 });
    wobblyFill(
      [
        [34, 34],
        [34, 90],
        [34 + 50 * beat, 62],
      ],
      BRAND.goldBright,
    );
    drawText(cue.text, 110, 58, { ...font, color: BRAND.copyOnInk, wobble: 0.2 });
    if (cue.sub) drawText(cue.sub, 112, 100, { ...subFont, color: BRAND.mutedOnInk, wobble: 0.2 });
  });
};

SFX_OF.nowPlaying = (cue, duration) => cardSfx(duration);
