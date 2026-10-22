// Created by The Angelo Umali.
// Gauges: effort slider, balance scale, count-up number and stopwatch.

// Markers and pans alternate steel and gold, so two of them never share a colour.
const SIDE_TINTS = [BRAND.steel, BRAND.gold];

// Effort slider with one marker per model; a marker may slide to a new level at `moveAt` seconds.
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const effortMarkerAt = (index) => 0.3 + index * 0.25;

COMPONENTS.effortMeter = (cue, env) => {
  const { local } = env;
  const trackX = 90;
  const trackW = 780;
  const levelX = (level) => trackX + (EFFORT_LEVELS.indexOf(level) / (EFFORT_LEVELS.length - 1)) * trackW;
  const head = headLayout(null, cue.text);
  panelCard(
    env,
    cardTop(cue),
    420,
    () => {
      drawHead(null, cue.text, local, head);
      drawStill(() => {
        sketchLine(trackX, 250, trackX + trackW, 250, { width: 8, color: BRAND.lineStrong, passes: 1, overshoot: 0 });
        EFFORT_LEVELS.forEach((level) => sketchLine(levelX(level), 234, levelX(level), 266, { width: 4, color: BRAND.lineStrong, passes: 1, overshoot: 0 }));
      });
      EFFORT_LEVELS.forEach((level) => drawText(level, levelX(level), 320, { ...TYPE.mono, size: 34, align: "center", color: BRAND.muted, wobble: 0.2 }));
      // First marker labels above the track, second below the level names, so neither hides a level.
      cue.markers.forEach((marker, index) => {
        const move = marker.moveTo ? springAt(local - marker.moveAt) : 0;
        const x = lerp(levelX(marker.level), levelX(marker.moveTo ?? marker.level), move);
        const pop = springAt(local - effortMarkerAt(index), SPRING.snappy);
        if (pop <= 0) return;
        const labelW = chipWidth(marker.label);
        drawScaled(x, 250, pop, () => {
          drawChip(-labelW / 2, index === 0 ? -112 : 82, marker.label);
          nodeRing(0, 0, 24, { color: identityTint(marker.color, SIDE_TINTS[index % 2]), surface: BRAND.paper });
        });
      });
    },
    cardAccent(local),
  );
};

SFX_OF.effortMeter = (cue, duration) =>
  cardSfx(duration, [
    ...cue.markers.map((marker, index) => ({ at: effortMarkerAt(index), sound: "tick", pan: tickPan(index) })),
    ...cue.markers.filter((marker) => marker.moveTo).map((marker) => ({ at: marker.moveAt, sound: "rule" })),
  ]);

// Balance beam on the footage, drawn like footage text; tilt -1 favours the left pan, +1 the right.
// `tiltTo` eases in at `tiltAt`. The arm keeps both pans inside the side margins.
const SCALE_ARM = 350;
const SCALE_PAN_RX = 120;
COMPONENTS.balanceScale = (cue, env) => {
  const { local } = env;
  const wobble = Math.sin(local * 5) * 0.02 * (1 - span(local, 0, 2));
  const tiltValue = lerp(cue.tilt ?? 0, cue.tiltTo ?? cue.tilt ?? 0, ease.inOut(span(local, cue.tiltAt ?? 0, (cue.tiltAt ?? 0) + 0.8)));
  const angle = tiltValue * 0.18 + wobble;
  withMotion(PW / 2, cue.y ?? SAFE.top + 30, env, () => {
    const base = [
      [-90, 430],
      [90, 430],
      [60, 400],
      [-60, 400],
    ];
    outlinedStroke((color, grow) => sketchLine(0, 90, 0, 400, { width: 10 + grow, color, passes: 1 }));
    wobblyFill(base, BRAND.paper);
    sketchPolygon(base, { width: 5 });
    ctx.save();
    ctx.translate(0, 90);
    ctx.rotate(angle);
    outlinedStroke((color, grow) => sketchLine(-SCALE_ARM, 0, SCALE_ARM, 0, { width: 10 + grow, color, passes: 1 }));
    ctx.restore();
    nodeRing(0, 90, 22, { color: BRAND.goldBright, surface: BRAND.ink });
    [
      [-1, cue.left],
      [1, cue.right],
    ].forEach(([side, pan], index) => {
      const armX = side * SCALE_ARM * Math.cos(angle);
      const armY = 90 + side * SCALE_ARM * Math.sin(angle);
      [-90, 90].forEach((reach) =>
        outlinedStroke((color, grow) => sketchLine(armX, armY, armX + reach, armY + 120, { width: 4 + grow, color, passes: 1 }), { grow: 5 }),
      );
      sketchEllipse(armX, armY + 124, SCALE_PAN_RX, 24, { fill: identityTint(pan.color, SIDE_TINTS[index]), width: 5, passes: 1 });
      // Fitted to its pan, then kept inside the safe columns (this space is centred on PW / 2).
      const labelFont = { ...TYPE.display, size: 54 };
      labelFont.size = fitFontSize(pan.text, labelFont, 2 * SCALE_PAN_RX);
      const halfLabel = textWidth(pan.text, labelFont) / 2;
      const labelX = clamp(armX, SAFE.left - PW / 2 + halfLabel, SAFE.right - PW / 2 - halfLabel);
      strokedText(pan.text, labelX, armY + 205, labelFont, { align: "center" });
    });
  });
};

SFX_OF.balanceScale = (cue, duration) => cardSfx(duration);

// Number that counts up on the counter spring, a goldBright suffix that pops (snappy), a label and a hand sub.
const COUNT_START = 0.15;
const COUNT_SETTLE = settleTime(SPRING.counter);
const SUFFIX_POP_AT = COUNT_START + 0.4;

COMPONENTS.bigNumber = (cue, env) => {
  const { local } = env;
  const digits = cue.decimals ?? 0;
  const numberFont = { ...TYPE.display, size: cue.size ?? 210 };
  const suffix = cue.suffix ?? "";
  const suffixFont = { ...numberFont, size: numberFont.size * 0.6 };
  const numberWidth = textWidth(formatCount(cue.value, digits), numberFont);
  const gap = suffix ? numberFont.size * 0.06 : 0;
  // Laid out at the final value, so the suffix stays put while the digits count up.
  const numberRight = numberWidth - (numberWidth + gap + textWidth(suffix, suffixFont)) / 2;
  withMotion(PW / 2, cue.y ?? 400, env, () => {
    strokedText(countUp(cue.value, local, COUNT_START, { decimals: digits }), numberRight, 40, numberFont, {
      align: "right",
      fill: cue.color ?? BRAND.paper,
      outline: 16,
    });
    const suffixPop = springAt(local - SUFFIX_POP_AT, SPRING.snappy);
    if (suffix && suffixPop > 0)
      drawScaled(numberRight + gap, 40, lerp(0.5, 1, suffixPop), () => strokedText(suffix, 0, 0, suffixFont, { fill: BRAND.goldBright, outline: 12 }));
    strokedText(cue.text, 0, 140, { ...TYPE.label, size: 58 }, { align: "center", outline: 12 });
    if (cue.sub)
      strokedText(cue.sub, 0, 215, { ...TYPE.hand, size: 56 }, { align: "center", fill: BRAND.goldBright, reveal: span(local, ...penSpan(cue.sub, 0.5)) });
  });
};

// Count-up ticks from `start`; the settle pluck lands at `dur`, before the number exits (never a negative span).
const countSfx = (start, duration) => ({ at: start, sound: "count", dur: Math.max(0, Math.min(COUNT_SETTLE, duration - EXIT - start)) });

SFX_OF.bigNumber = (cue, duration) => [countSfx(COUNT_START, duration)];

// Stopwatch face with a sweeping hand and a handwritten caption; y is the dial centre (its knob reaches 200 above).
COMPONENTS.stopwatch = (cue, env) => {
  const { local } = env;
  withMotion(PW / 2, cue.y ?? SAFE.top + 200, env, () => {
    sketchRect(-26, -200, 52, 40, { fill: BRAND.ink, width: 3, passes: 1 });
    const minute = local * 4;
    // The kit clock's minute hand is the kit accent; the brand hand is gold.
    withKitColors({ accent: BRAND.gold }, () => drawClock(0, 0, 160, minute, minute / 12));
    strokedText(
      cue.text,
      0,
      260,
      { ...TYPE.hand, size: 84 },
      { align: "center", fill: cue.color ?? BRAND.paper, reveal: span(local, ...penSpan(cue.text, 0.3)) },
    );
  });
};

SFX_OF.stopwatch = (cue, duration) => cardSfx(duration);
