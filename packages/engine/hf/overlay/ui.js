// Created by The Angelo Umali.
// Shared portrait-overlay constants and drawing helpers built on the kit, in the ZKidz brand.
// Names avoid the kit's globals (W, H, span, stamp, ...) because classic scripts share one scope.
const PW = 1080;
const PH = 1920;
const PANEL_W = SAFE.right - SAFE.left;
const safeRight = (y) => (y >= SAFE.columnTop ? SAFE.columnRight : SAFE.right);
const TEAM = { bad: BRAND.negative };
const COMPONENTS = {};
// SFX_OF[kind](cue, duration) -> [{ at, sound, pan, gain, dur }]; declared before any component registers.
const SFX_OF = {};

// 9353 → "9,353"; rounds half away from zero, same as Math.round for the positive counts shown here.
const formatCount = (value, digits = 0) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const rectPoints = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

// Offset ink shadow under any polygon so it separates from busy footage.
function dropShadow(points, dx = 6, dy = 8, alpha = 0.22) {
  wobblyFill(
    points.map(([px, py]) => [px + dx, py + dy]),
    C.ink,
    alpha,
  );
}

// Legacy name for brandCard (a plain alias would fail: brand-draw.js loads after this file).
const ovlCard = (x, y, w, h, options) => brandCard(x, y, w, h, options);

// A top-band card's requested top: the cue's own y, else just under the safe top.
const cardTop = (cue) => cue.y ?? SAFE.top + 20;

// Full-width card kept in the top band; `draw` runs in card space (0,0 = card top-left).
function panelCard(env, y, height, draw, cardOptions) {
  withMotion(PW / 2, bandTop(y, height), env, () => {
    ctx.translate(-PANEL_W / 2, 0);
    ovlCard(0, 0, PANEL_W, height, cardOptions);
    draw();
  });
}

function wrapLines(text, font, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate, font) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

const CHIP_FONT = { family: FONT.mono, size: 36, weight: 600 };
const CHIP_HEIGHT = CHIP_FONT.size + 30;
const chipWidth = (text) => textWidth(text, CHIP_FONT) + 40;

// Brand chip (spec §2.5): mono ink on white with a lineStrong edge; hot chips pass an ink fill and goldBright text.
function drawChip(x, y, text, { fill = BRAND.white, color = BRAND.ink, edge = BRAND.lineStrong } = {}) {
  const width = chipWidth(text);
  drawStill(() => {
    dropShadow(rectPoints(x, y, width, CHIP_HEIGHT));
    sketchRect(x, y, width, CHIP_HEIGHT, { fill, color: edge, width: 2.5, passes: 1, rough: 1, overshoot: 0 });
    drawText(text, x + 20, y + CHIP_HEIGHT / 2 + CHIP_FONT.size * 0.36, { ...CHIP_FONT, color, wobble: 0.2 });
  });
}

// Comic star: `inner` is the valley radius as a fraction, `stretch` widens it horizontally.
function starBurst(radius, spikes, color, { inner = 0.62, stretch = 1.25, edge = C.ink } = {}) {
  const points = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? radius * inner : radius;
    const angle = (i / (spikes * 2)) * Math.PI * 2;
    points.push([Math.cos(angle) * r * stretch, Math.sin(angle) * r]);
  }
  dropShadow(points);
  wobblyFill(points, color);
  sketchPolygon(points, { width: 5, color: edge });
}

function drawCross(x, y, size, { progress = 1, color = TEAM.bad, width = size * 0.18 } = {}) {
  const half = size / 2;
  const first = span(progress, 0, 0.5);
  const second = span(progress, 0.5, 1);
  if (first > 0) sketchLine(x - half, y - half, lerp(x - half, x + half, first), lerp(y - half, y + half, first), { color, width, passes: 1 });
  if (second > 0) sketchLine(x + half, y - half, lerp(x + half, x - half, second), lerp(y - half, y + half, second), { color, width, passes: 1 });
}

// The window strokedText's `reveal` opens left to right, in text space at full reveal: [left, top, width, height].
function strokedRevealBox(text, font, align) {
  const width = textWidth(text, font);
  const left = align === "center" ? -width / 2 : align === "right" ? -width : 0;
  return [left - 30, -font.size * 1.5, width + 60, font.size * 2.5];
}

// Text drawn straight on footage: an ink outline of at least 0.13 x size under a paper fill keeps it legible.
function strokedText(
  text,
  x,
  y,
  font,
  { fill = BRAND.paper, stroke = BRAND.ink, outline = Math.max(12, font.size * 0.13), align = "left", rot = 0, reveal = 1 } = {},
) {
  const rand = nextRng();
  ctx.save();
  applyFont(font);
  ctx.textAlign = align;
  ctx.translate(x + jitter(rand, 1), y + jitter(rand, 1));
  ctx.rotate(rot);
  if (reveal < 1) {
    const [left, top, width, height] = strokedRevealBox(text, font, align);
    ctx.beginPath();
    ctx.rect(left, top, width * reveal, height);
    ctx.clip();
  }
  ctx.lineJoin = "round";
  ctx.lineWidth = outline;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

const LAPTOP_LIP = 24; // the base overhangs the screen by this much each side

function drawLaptop(x, y, width, label) {
  const screenHeight = width * 0.62;
  const base = [
    [x - LAPTOP_LIP, y + screenHeight],
    [x + width + LAPTOP_LIP, y + screenHeight],
    [x + width + 8, y + screenHeight + 22],
    [x - 8, y + screenHeight + 22],
  ];
  sketchRect(x, y, width, screenHeight, { fill: C.ink, color: C.ink, width: 4, passes: 1 });
  sketchRect(x + 10, y + 10, width - 20, screenHeight - 20, { fill: BRAND.lineStrong, stroke: false });
  wobblyFill(base, C.lightGray);
  sketchPolygon(base, { width: 3 });
  strokedText(label, x + width / 2, y + screenHeight + 76, { family: FONT.hand, size: 48, weight: 700 }, { align: "center" });
}

// ?guides=1: the unsafe margins in BRAND.line with the safe outline dashed in steel, drawn dead still over the frame.
function drawSafeGuides() {
  const safeArea = new Path2D();
  [
    [SAFE.left, SAFE.top],
    [SAFE.right, SAFE.top],
    [SAFE.right, SAFE.columnTop],
    [SAFE.columnRight, SAFE.columnTop],
    [SAFE.columnRight, SAFE.bottom],
    [SAFE.left, SAFE.bottom],
  ].forEach(([x, y]) => safeArea.lineTo(x, y));
  safeArea.closePath();
  const margins = new Path2D();
  margins.rect(0, 0, PW, PH);
  margins.addPath(safeArea);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = BRAND.line;
  ctx.fill(margins, "evenodd");
  ctx.setLineDash([18, 10]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = BRAND.steel;
  ctx.stroke(safeArea);
  ctx.restore();
}
