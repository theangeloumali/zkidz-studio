// Created by The Angelo Umali.
// English caption plate: paper Inter on an ink plate with a goldBright rule on its left edge, in the bottom safe band.
// Cues come from cues/<video>-cc.json (zks_engine/captions.py), which loads last, so the plate draws over every card.
// Crisp on purpose: no boil, no wobble. Moving linework re-encodes every frame, and subtitles must read at a glance.
// Bottom at 1430: under the face zone (y ~700-1100), inside TikTok's relaxed bottom bound (1436). The both-platform
// bound (1248) sat the plate on the speaker's chest.
const CAPTION = { bottom: 1430, left: SAFE.left, right: SAFE.columnRight, padX: 28, padY: 18, rule: 6, radius: 10, alpha: 0.86 };
const CAPTION_FONT = { family: INTER, size: 50, weight: 600 };
const CAPTION_MIN_SIZE = 38;
const CAPTION_LINE = 1.25; // line height in font sizes
const CAPTION_TEXT_W = CAPTION.right - CAPTION.left - CAPTION.rule - CAPTION.padX * 2;
const CAPTION_DODGE = 16;
// Plates the caption must not cover, as [top, bottom] in frame px: the caption rides above one only when they overlap.
const namePlateSpan = (cue) => [cue.y ?? PLATE.top, (cue.y ?? PLATE.top) + PLATE.height];
const BAND_OWNERS = { lowerThird: namePlateSpan, nameTag: namePlateSpan };

// Two lines at most: the font shrinks before a third line appears.
function captionLayout(text) {
  let font = CAPTION_FONT;
  let lines = wrapLines(text, font, CAPTION_TEXT_W);
  while (lines.length > 2 && font.size > CAPTION_MIN_SIZE) {
    font = { ...font, size: font.size - 2 };
    lines = wrapLines(text, font, CAPTION_TEXT_W);
  }
  const textW = Math.max(...lines.map((line) => textWidth(line, font)));
  const lineHeight = font.size * CAPTION_LINE;
  return { font, lines, lineHeight, width: CAPTION.rule + CAPTION.padX * 2 + textW, height: CAPTION.padY * 2 + lineHeight * lines.length };
}

function captionBottom(time, height, preferredBottom = CAPTION.bottom) {
  const spans = activeCues(time).flatMap((other) => (BAND_OWNERS[other.kind] ? [BAND_OWNERS[other.kind](other)] : []));
  const clashing = spans.filter(([top, bottom]) => top < preferredBottom && bottom > preferredBottom - height);
  return Math.min(preferredBottom, ...clashing.map(([top]) => top - CAPTION_DODGE));
}

COMPONENTS.caption = (cue, env) => {
  // timemap.js marks a caption that touches its neighbour on the edit.
  const { joinsBefore, joinsAfter } = cue;
  const rise = joinsBefore ? { alpha: 1, dy: 0 } : riseIn(env.local, 0, { distance: 10, scaleFrom: 1 });
  const alpha = rise.alpha * (joinsAfter ? 1 : 1 - env.exit);
  if (alpha <= 0) return;
  const { font, lines, lineHeight, width, height } = captionLayout(cue.text);
  const top = captionBottom(cue.start + env.local, height, cue.bottom ?? CAPTION.bottom) - height + rise.dy;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = BRAND.ink;
  ctx.globalAlpha *= CAPTION.alpha;
  ctx.beginPath();
  ctx.roundRect(CAPTION.left, top, width, height, CAPTION.radius);
  ctx.fill();
  ctx.globalAlpha /= CAPTION.alpha;
  ctx.fillStyle = BRAND.goldBright;
  ctx.fillRect(CAPTION.left, top, CAPTION.rule, height);
  applyFont(font);
  ctx.fillStyle = BRAND.copyOnInk;
  ctx.textBaseline = "alphabetic";
  const textX = CAPTION.left + CAPTION.rule + CAPTION.padX;
  // Baselines sit at 0.8 of each line box: Inter's cap height centres there at this line height.
  lines.forEach((line, index) => ctx.fillText(line, textX, top + CAPTION.padY + lineHeight * (index + 0.8)));
  ctx.restore();
};
