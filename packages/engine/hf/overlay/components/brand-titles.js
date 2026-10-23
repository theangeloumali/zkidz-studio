// Created by The Angelo Umali.
// Brand titles: the hook title, the name plate (lowerThird, alias nameTag), chapter cards and keyword pop-ups.

// Opening title over the footage (spec §5.6): kicker on an ink tab, serif lines rising word by word, one gold rule.
const HOOK = { size: 108, lineHeight: 1.02, firstWord: 0.15, step: 0.1, rule: 0.55, kicker: 34 };

// The fitted font, the kicker baseline, each line's baseline, colour and first-word start, and the rule under them.
function hookLayout(cue) {
  // 12 px spare for the ink outline and glyph overhang, which carried "week" past x 1015.
  const font = fittedFont({ ...TYPE.display, size: HOOK.size }, cue.lines, PANEL_W - 12);
  const lineHeight = font.size * HOOK.lineHeight;
  const ruleDrop = font.size * 0.42;
  // Kept above the button column, so the full band width holds for every line.
  const top = bandTop(cue.y, 62 + font.size + (cue.lines.length - 1) * lineHeight + ruleDrop + 12);
  let wordIndex = 0;
  const lines = cue.lines.map((text, index) => {
    const start = HOOK.firstWord + wordIndex * HOOK.step;
    wordIndex += text.split(" ").length;
    return { text, start, baseline: top + 62 + font.size + index * lineHeight, color: index === cue.accentLine ? BRAND.goldBright : BRAND.paper };
  });
  const rule = { y: lines.at(-1).baseline + ruleDrop, width: Math.max(...cue.lines.map((line) => textWidth(line, font))) };
  // A kicker baseline one kicker size down puts the ink tab's top edge at the band top.
  return { font, top, kickerBaseline: top + HOOK.kicker, lines, outline: Math.round(font.size * 0.13), rule };
}

COMPONENTS.hookTitle = (cue, env) => {
  const { local } = env;
  const layout = hookLayout(cue);
  const exit = exitOut(env);
  ctx.save();
  ctx.globalAlpha *= exit.alpha;
  ctx.translate(0, exit.dy);
  drawStill(() => {
    if (cue.kicker) kicker(cue.kicker, SAFE.left, layout.kickerBaseline, local, 0, { onFootage: true, size: HOOK.kicker });
    layout.lines.forEach(({ text, start, baseline, color }) =>
      wordsRise(text, SAFE.left, baseline, layout.font, local, start, { outline: layout.outline, color }),
    );
  });
  goldRule(SAFE.left, layout.rule.y, layout.rule.width, springAt(local - HOOK.rule), { onFootage: true });
  ctx.restore();
};
SFX_OF.hookTitle = () => [
  { at: HOOK.firstWord, sound: "hook" },
  { at: HOOK.rule + 0.02, sound: "rule" },
];

// Name plate: the BRAND.md lockup ×2.6 (spec §5.4). The Z writes itself, the name rises and the kicker's tracking
// settles 0.32 → 0.18 em. The plate keeps to y 1080-1240, above both apps' bottom UI and left of the button column;
// `y` moves it (its top) when his face sits low enough for the plate to cover his mouth.
const PLATE = { top: 1080, height: 160, mark: 120, textX: 156, maxWidth: SAFE.columnRight - SAFE.left, zStart: 0.15 };
const PLATE_KICKER = TYPE.kicker;

function plateLayout(cue) {
  const nameFont = { ...TYPE.display, size: cue.role ? 58 : 64 };
  const roleFont = { ...TYPE.body, size: 34 };
  const kickerText = (cue.sub ?? "ZKidz Dev LLC").toUpperCase();
  const widestText = Math.max(textWidth(cue.name, nameFont), cue.role ? textWidth(cue.role, roleFont) : 0, trackedWidth(kickerText, PLATE_KICKER, 0.32));
  const width = Math.min(PLATE.maxWidth, PLATE.textX + widestText + 40);
  const baselines = cue.role ? { name: 60, role: 103, kicker: 145 } : { name: 80, kicker: 129 };
  return { nameFont, roleFont, kickerText, width, baselines };
}

COMPONENTS.lowerThird = (cue, env) => {
  const { local } = env;
  const { nameFont, roleFont, kickerText, width, baselines } = plateLayout(cue);
  const textMax = width - PLATE.textX - 30;
  withMotion(SAFE.left, cue.y ?? PLATE.top, env, () => {
    brandCard(0, 0, width, PLATE.height);
    drawBrandZ(30, (PLATE.height - PLATE.mark) / 2, PLATE.mark, brandZTiming(local, PLATE.zStart));
    drawStill(() => {
      wordsRise(cue.name, PLATE.textX, baselines.name, { ...nameFont, size: fitFontSize(cue.name, nameFont, textMax) }, local, 0.3);
      const role = cue.role && { ...roleFont, size: fitFontSize(cue.role, roleFont, textMax) };
      if (role) riseText(cue.role, PLATE.textX, baselines.role, role, riseIn(local, 0.45, { distance: 14, scaleFrom: 1 }), { color: BRAND.lineStrong });
      const settle = springAt(local - 0.55);
      ctx.save();
      ctx.globalAlpha *= riseAlpha(settle);
      trackedText(kickerText, PLATE.textX, baselines.kicker, PLATE_KICKER, lerp(0.32, 0.18, settle), { color: BRAND.muted, wobble: 0 });
      ctx.restore();
    });
    goldRule(0, PLATE.height, width, springAt(local - 0.6), { thickness: 3 });
  });
};
// Logo draw sounds (spec §6.2): steel pluck on the first node, pencil while the strokes draw, gold pluck on the last.
SFX_OF.lowerThird = () => [
  { at: PLATE.zStart, sound: "nodeSteel", pan: -0.15 },
  { at: PLATE.zStart + 0.25, sound: "pencil", dur: 0.45 },
  { at: PLATE.zStart + Z_GOLD_NODE_AT, sound: "nodeGold", pan: 0.15 },
];
COMPONENTS.nameTag = COMPONENTS.lowerThird;
SFX_OF.nameTag = SFX_OF.lowerThird;

// Chapter card (spec §5.5): the panel wipes open from the left with a gold edge riding the clip, and wipes out right.
const CHAPTER = { wipeOut: 0.25, balloonX: CARD_PAD + 34, balloon: 35, rowY: 70, title: 176, sub: 228, subSize: 36, stem: 96 };

// Card height and top, where the stem starts, and the fitted title and sub fonts (card space).
function chapterLayout(cue) {
  const height = cue.sub ? 268 : 216;
  const titleFont = fittedFont({ ...TYPE.display, size: 76 }, [cue.title], CARD_INNER);
  return {
    height,
    top: bandTop(cue.y, height),
    lineStart: CHAPTER.balloonX + CHAPTER.balloon + 11,
    titleFont,
    subFont: cue.sub && fittedFont({ ...TYPE.body, size: CHAPTER.subSize }, [cue.sub], CARD_INNER),
  };
}

// The steel stem out of the balloon grown to `progress`, its gold node popped to `pop` at the tip.
function drawChapterStem(lineStart, progress, pop) {
  const tip = lineStart + CHAPTER.stem * progress;
  if (tip <= lineStart + 1) return;
  sketchLine(lineStart, CHAPTER.rowY, tip, CHAPTER.rowY, { color: BRAND.steel, width: 2.5, passes: 1, rough: 0.6, overshoot: 0 });
  nodeRing(tip, CHAPTER.rowY, 9, { color: BRAND.gold, surface: BRAND.paper, pop });
}

COMPONENTS.chapterCard = (cue, env) => {
  const { local, duration } = env;
  const { height, top, lineStart, titleFont, subFont } = chapterLayout(cue);
  const open = springAt(local);
  const close = ease.in(span(local, duration - CHAPTER.wipeOut, duration));
  const clipLeft = SAFE.left - 6 + (PANEL_W + 20) * close;
  const clipRight = SAFE.left + (PANEL_W + 20) * open;
  if (clipRight <= clipLeft) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clipLeft, top - 12, clipRight - clipLeft, height + 30);
  ctx.clip();
  ctx.translate(SAFE.left, top);
  brandCard(0, 0, PANEL_W, height);
  if (cue.index !== undefined) numberBalloon(cue.index, CHAPTER.balloonX, CHAPTER.rowY, CHAPTER.balloon, springAt(local - 0.2, SPRING.snappy));
  drawChapterStem(lineStart, springAt(local - 0.3), springAt(local - 0.3, SPRING.snappy));
  drawStill(() => {
    if (cue.kicker) kicker(cue.kicker, lineStart + 124, CHAPTER.rowY + 10, local, 0.35);
    wordsRise(cue.title, CARD_PAD, CHAPTER.title, titleFont, local, 0.25);
    if (subFont) riseText(cue.sub, CARD_PAD, CHAPTER.sub, subFont, riseIn(local, 0.55, { distance: 14, scaleFrom: 1 }), { color: BRAND.muted });
  });
  ctx.restore();
  if (open < 0.98) wipeEdge(clipRight, top - 4, height + 8);
};
// sfx.py plucks 0.35 s and 0.47 s after the whoosh starts: at 0.25 and 0.37 (spec §6.2), with the balloon and node.
SFX_OF.chapterCard = (cue, duration) => [
  { at: -0.1, sound: "chapter" },
  { at: duration - CHAPTER.wipeOut, sound: "swishOut" },
];

// Keyword pop-up (spec §5.7), the video's main device: serif on the footage, a paper card, or a mono chip.
// y is the text baseline; the pop-up is pushed back inside the safe zone whatever x and align say.
const KEYWORD = { footage: 96, paper: 72, chip: 48, accent: 0.3 };

function keywordBox(cue) {
  const tone = cue.tone ?? "footage";
  const size = cue.size ?? KEYWORD[tone];
  // Room above the baseline for the tallest tone (a paper card is 1.3 × size), and nothing below the floor.
  const y = clamp(cue.y ?? 560, SAFE.top + size * 1.4, SAFE.bottom - size);
  const right = safeRight(y + size * 0.3);
  const font = fittedFont({ ...(tone === "chip" ? TYPE.mono : TYPE.display), size }, [cue.text], PANEL_W - 120);
  const chipScale = size / CHIP_FONT.size;
  const chipHeight = CHIP_HEIGHT * chipScale;
  const pad = tone === "paper" ? 40 : 0;
  const paperBaseline = 28 + font.size * 0.86;
  const paperHeight = font.size * 1.12 + 2 * 28 + (cue.accent ? 22 : 0);
  const boxWidth = tone === "chip" ? chipWidth(cue.text) * chipScale : textWidth(cue.text, font) + 2 * pad;
  // drawChip sets its baseline 0.36 × size below the chip's middle; keep that baseline on y.
  const middle = tone === "chip" ? y - CHIP_FONT.size * 0.36 * chipScale : tone === "paper" ? y - paperBaseline + paperHeight / 2 : y - font.size * 0.34;
  const width = boxWidth;
  const align = cue.align ?? "center";
  const anchor = cue.x ?? (align === "left" ? SAFE.left : align === "right" ? right : PW / 2);
  const left = clamp(align === "center" ? anchor - width / 2 : align === "right" ? anchor - width : anchor, SAFE.left, right - width);
  return { tone, y, font, chipScale, chipHeight, pad, paperBaseline, paperHeight, boxWidth, middle, left };
}

COMPONENTS.keyword = (cue, env) => {
  const { local } = env;
  const box = keywordBox(cue);
  const { tone, y, font, pad, boxWidth, left } = box;
  const accent = springAt(local - KEYWORD.accent);
  if (tone === "chip") {
    const hot = cue.accent ? HOT_CHIP : {};
    const drawScaledChip = () => drawScaled(-boxWidth / 2, -box.chipHeight / 2, box.chipScale, () => drawChip(0, 0, cue.text, hot));
    withMotion(left + boxWidth / 2, box.middle, env, drawScaledChip, { preset: SPRING.snappy, distance: 12, scaleFrom: 0.9 });
  } else if (tone === "paper") {
    withMotion(left, y - box.paperBaseline, env, () => {
      brandCard(0, 0, boxWidth, box.paperHeight);
      drawStill(() => wordsRise(cue.text, pad, box.paperBaseline, font, local, 0.1, { step: 0.08 }));
      if (cue.accent) goldRule(pad, box.paperBaseline + font.size * 0.3, boxWidth - 2 * pad, accent, { thickness: 4 });
    });
  }
  const exit = exitOut(env);
  ctx.save();
  ctx.globalAlpha *= exit.alpha;
  ctx.translate(0, exit.dy);
  if (tone === "footage") {
    drawStill(() => wordsRise(cue.text, left, y, font, local, 0, { step: 0.08, outline: Math.round(font.size * 0.13) }));
    if (cue.accent) goldRule(left, y + font.size * 0.32, boxWidth, accent, { onFootage: true });
  }
  ctx.restore();
};
SFX_OF.keyword = (cue) => {
  const tone = cue.tone ?? "footage";
  const events = [tone === "paper" ? { at: -0.06, sound: "swish" } : { at: 0.05, sound: "tick" }];
  if (cue.accent && tone !== "chip") events.push({ at: KEYWORD.accent + 0.02, sound: "rule" });
  return events;
};
