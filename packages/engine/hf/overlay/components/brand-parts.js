// Created by The Angelo Umali.
// Parts shared by the brand-* components: card heads, numbered balloons, status pills. Card SFX,
// tick pans, settle times and the woven-Z beats come from labels.js and banners.js, which load first.

const CARD_PAD = 44;
const CARD_INNER = PANEL_W - 2 * CARD_PAD;
const HEAD_KICKER = 64; // kicker baseline, card space
const HEAD_TITLE = { ...TYPE.display, size: 60 };

// Largest size ≤ font.size at which every text fits maxWidth.
const fittedFont = (font, texts, maxWidth) => ({ ...font, size: Math.min(font.size, ...texts.map((text) => fitFontSize(text, font, maxWidth))) });

// Kicker and serif title at the top of a data card, in card space; `bottom` is where the body may start.
function headLayout(kickerText, title) {
  const titleFont = title ? fittedFont(HEAD_TITLE, [title], CARD_INNER) : HEAD_TITLE;
  const titleBaseline = (kickerText ? HEAD_KICKER + 20 : CARD_PAD) + titleFont.size * 0.78;
  const bottom = title ? titleBaseline + 20 : kickerText ? HEAD_KICKER + 12 : 12;
  return { titleFont, titleBaseline, bottom };
}

function drawHead(kickerText, title, local, layout) {
  if (kickerText) kicker(kickerText, CARD_PAD, HEAD_KICKER, local, 0.1);
  if (title) drawStill(() => wordsRise(title, CARD_PAD, layout.titleBaseline, layout.titleFont, local, 0.2));
}

// Numbered balloon from the drafting sheet in brand ink: a thin ring holding a mono numeral, popping on snappy.
function numberBalloon(label, x, y, radius, pop, { color = BRAND.lineStrong, fill = BRAND.paper } = {}) {
  if (pop <= 0) return;
  drawScaled(x, y, pop, () => {
    sketchEllipse(0, 0, radius, radius, { color, width: 3, fill, passes: 1, rough: 0.5 });
    drawText(String(label), 0, radius * 0.34, { ...TYPE.mono, size: radius * 0.92, color, align: "center", wobble: 0 });
  });
}

// Stadium outline (a dashboard status pill) as a closed polyline for wobblyFill / sketchPath.
function pillPoints(x, y, width, height) {
  const radius = height / 2;
  const arc = (centerX, from) =>
    Array.from({ length: 9 }, (_, step) => {
      const angle = from + (Math.PI * step) / 8;
      return [centerX + Math.cos(angle) * radius, y + radius + Math.sin(angle) * radius];
    });
  const points = [...arc(x + width - radius, -Math.PI / 2), ...arc(x + radius, Math.PI / 2)];
  return [...points, points[0]];
}
