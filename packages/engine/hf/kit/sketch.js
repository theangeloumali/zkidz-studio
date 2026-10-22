// Created by The Angelo Umali.
// Hand-drawn canvas kit. Strokes re-seed on a 12 fps "boil" so lines breathe like cel animation
// while the video still runs at 30 fps.
const PORTRAIT = new URLSearchParams(location.search).get("format") === "vertical"; // TikTok/Reels 9:16
const [W, H] = PORTRAIT ? [1080, 1920] : [1920, 1080];
const C = {
  ink: "#172230",
  paper: "#f3efe8",
  paper2: "#e9e3d8",
  white: "#ffffff",
  accent: "#c9a838",
  accentDark: "#b4483c",
  sky: "#5b8db8",
  olive: "#6f8a4e",
  gray: "#526171",
  lightGray: "#95a3b3",
  teal: "#2E5F74",
  gold: "#D4AF36",
};
// ZKidz brand tokens (light mode).
const Z = {
  ink: "#172230",
  muted: "#526171",
  steel: "#3b7a9e",
  lineStrong: "#2e4a64",
  gold: "#c9a838",
  goldInk: "#9f7e16",
  fill: "#f3efe8",
};
const FONT = { serif: "Newsreader", sans: "DM Sans", hand: "Caveat", pixel: "Press Start 2P", mono: "JetBrains Mono" };

let ctx = null;
let boilStep = 0;
let frameIndex = 0;
let seedCounter = 0;

function beginFrame(context, timeSeconds) {
  ctx = context;
  boilStep = Math.floor(timeSeconds * 12);
  frameIndex = Math.round(timeSeconds * 30);
  seedCounter = 0;
}

function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Draw order is deterministic, so the Nth stroke keeps its seed for a whole boil step.
function nextRng() {
  seedCounter += 1;
  return mulberry32(seedCounter * 7919 + boilStep * 104729);
}
// Scaled local-space drawing (drawScaled) divides jitter so wobble stays in screen pixels.
let jitterScale = 1;
const jitter = (rand, amount) => (rand() - 0.5) * 2 * amount * jitterScale;

// scaleJitter false lets the wobble shrink with the drawing (small icons stop boiling at full size).
function drawScaled(x, y, scale, draw, { scaleJitter = true } = {}) {
  const outerJitterScale = jitterScale;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (scaleJitter) jitterScale = outerJitterScale / scale;
  draw();
  jitterScale = outerJitterScale;
  ctx.restore();
}

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const lerp = (from, to, progress) => from + (to - from) * progress;
const span = (time, start, end) => clamp((time - start) / (end - start));
const ease = {
  out: (p) => 1 - Math.pow(1 - p, 3),
  in: (p) => p * p * p,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  back: (p) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2),
};

function applyStroke(options) {
  ctx.strokeStyle = options.color || C.ink;
  ctx.lineWidth = options.width || 4;
  ctx.lineCap = options.cap || "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha *= options.alpha ?? 1;
}

// Smoothed wobbly polyline; the second, thinner pass is what reads as pencil.
function sketchPath(points, options = {}) {
  if (points.length < 2) return;
  const rough = options.rough ?? 2;
  const passes = options.passes ?? 2;
  for (let pass = 0; pass < passes; pass++) {
    const rand = nextRng();
    ctx.save();
    applyStroke(options);
    if (pass > 0) {
      ctx.lineWidth *= 0.5;
      ctx.globalAlpha *= 0.65;
    }
    const wobbled = points.map(([x, y]) => [x + jitter(rand, rough), y + jitter(rand, rough)]);
    ctx.beginPath();
    ctx.moveTo(wobbled[0][0], wobbled[0][1]);
    for (let i = 1; i < wobbled.length - 1; i++) {
      if (options.sharp) {
        ctx.lineTo(wobbled[i][0], wobbled[i][1]);
        continue;
      }
      const midX = (wobbled[i][0] + wobbled[i + 1][0]) / 2;
      const midY = (wobbled[i][1] + wobbled[i + 1][1]) / 2;
      ctx.quadraticCurveTo(wobbled[i][0], wobbled[i][1], midX, midY);
    }
    const last = wobbled[wobbled.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
    ctx.restore();
  }
}

function sketchLine(x1, y1, x2, y2, options = {}) {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const rough = options.rough ?? 2;
  const overshoot = options.overshoot ?? Math.min(8, length * 0.04);
  const unitX = (x2 - x1) / length;
  const unitY = (y2 - y1) / length;
  const passes = options.passes ?? 2;
  for (let pass = 0; pass < passes; pass++) {
    const rand = nextRng();
    ctx.save();
    applyStroke(options);
    if (pass > 0) {
      ctx.lineWidth *= 0.5;
      ctx.globalAlpha *= 0.65;
    }
    const startOver = overshoot * rand();
    const endOver = overshoot * rand();
    const bow = jitter(rand, rough + length * 0.005);
    const startX = x1 - unitX * startOver + jitter(rand, rough);
    const startY = y1 - unitY * startOver + jitter(rand, rough);
    const endX = x2 + unitX * endOver + jitter(rand, rough);
    const endY = y2 + unitY * endOver + jitter(rand, rough);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo((x1 + x2) / 2 - unitY * bow, (y1 + y2) / 2 + unitX * bow, endX, endY);
    ctx.stroke();
    ctx.restore();
  }
}

function wobblyFill(points, color, alpha = 1) {
  const rand = nextRng();
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const wobbledX = x + jitter(rand, 1.5);
    const wobbledY = y + jitter(rand, 1.5);
    if (i === 0) ctx.moveTo(wobbledX, wobbledY);
    else ctx.lineTo(wobbledX, wobbledY);
  });
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Parallel pencil strokes clipped to a shape; `progress` reveals them one by one.
function hatch(clipShape, box, options = {}) {
  const angle = options.angle ?? -Math.PI / 4;
  const gap = options.gap ?? 14;
  const progress = options.progress ?? 1;
  const rand = nextRng();
  ctx.save();
  ctx.beginPath();
  const shapePath = clipShape();
  if (shapePath instanceof Path2D) ctx.clip(shapePath);
  else ctx.clip();
  applyStroke({ color: options.color, width: options.width ?? 3, alpha: options.alpha ?? 0.9 });
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  const reach = Math.hypot(box.w, box.h) / 2 + 10;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const count = Math.ceil((reach * 2) / gap);
  const visible = Math.floor(count * progress);
  ctx.beginPath();
  for (let i = 0; i < visible; i++) {
    const offset = -reach + i * gap + jitter(rand, gap * 0.2);
    const baseX = centerX - dirY * offset;
    const baseY = centerY + dirX * offset;
    ctx.moveTo(baseX - dirX * reach + jitter(rand, 4), baseY - dirY * reach + jitter(rand, 4));
    ctx.lineTo(baseX + dirX * reach + jitter(rand, 4), baseY + dirY * reach + jitter(rand, 4));
  }
  ctx.stroke();
  ctx.restore();
}

// Straight-edged outline; sketchPath would round the corners off.
function sketchPolygon(points, options = {}) {
  points.forEach(([fromX, fromY], i) => {
    const [toX, toY] = points[(i + 1) % points.length];
    sketchLine(fromX, fromY, toX, toY, { passes: 1, ...options });
  });
}

function sketchRect(x, y, w, h, options = {}) {
  const corners = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  if (options.fill) wobblyFill(corners, options.fill, options.fillAlpha ?? 1);
  if (options.hatch) {
    hatch(() => ctx.rect(x, y, w, h), { x, y, w, h }, options.hatch);
  }
  if (options.stroke === false) return;
  sketchPolygon(corners, { passes: 2, ...options });
}

function sketchEllipse(centerX, centerY, radiusX, radiusY, options = {}) {
  const rand = nextRng();
  if (options.fill) {
    ctx.save();
    ctx.fillStyle = options.fill;
    ctx.globalAlpha *= options.fillAlpha ?? 1;
    ctx.beginPath();
    ctx.ellipse(centerX + jitter(rand, 1.5), centerY + jitter(rand, 1.5), radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (options.stroke === false) return;
  const steps = 30;
  const randomStart = rand() * Math.PI * 2; // always drawn, so a fixed `start` keeps every later seed unchanged
  const startAngle = options.start ?? randomStart;
  const sweep = Math.PI * 2 * (options.sweep ?? 1.07);
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + (sweep * i) / steps;
    const wobble = 1 + jitter(rand, 0.025);
    points.push([centerX + Math.cos(angle) * radiusX * wobble, centerY + Math.sin(angle) * radiusY * wobble]);
  }
  sketchPath(points, { ...options, rough: options.rough ?? 1 });
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

// Leading fraction of a polyline, for draw-on reveals.
function slicePath(points, progress) {
  if (progress >= 1) return points;
  if (progress <= 0) return [];
  const target = pathLength(points) * clamp(progress);
  const sliced = [points[0]];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const segment = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (walked + segment >= target) {
      const part = segment ? (target - walked) / segment : 0;
      sliced.push([lerp(points[i - 1][0], points[i][0], part), lerp(points[i - 1][1], points[i][1], part)]);
      return sliced;
    }
    walked += segment;
    sliced.push(points[i]);
  }
  return sliced;
}

function pointAlong(points, progress) {
  if (progress <= 0) return points[0];
  const sliced = slicePath(points, progress);
  return sliced[sliced.length - 1];
}

function fontString(options) {
  return `${options.italic ? "italic " : ""}${options.weight || 400} ${options.size || 60}px "${options.family || FONT.sans}"`;
}

function applyFont(options) {
  ctx.font = fontString(options);
  if (options.tracking) ctx.letterSpacing = `${options.tracking}px`;
}

function textWidth(text, options) {
  ctx.save();
  applyFont(options);
  const width = ctx.measureText(text).width;
  ctx.restore();
  return width;
}

// Largest size ≤ options.size at which `text` fits in `maxWidth` pixels.
function fitFontSize(text, options, maxWidth) {
  return Math.min(options.size, (options.size * maxWidth) / textWidth(text, options));
}

// Text that boils with the linework; `reveal` wipes it on left to right like a pen.
// `maxWidth` shrinks the font until the text fits.
function drawText(text, x, y, options = {}) {
  if (options.maxWidth) options = { ...options, size: fitFontSize(text, options, options.maxWidth) };
  const rand = nextRng();
  const wobble = options.wobble ?? 1;
  ctx.save();
  applyFont(options);
  ctx.fillStyle = options.color || C.ink;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "alphabetic";
  ctx.globalAlpha *= options.alpha ?? 1;
  ctx.translate(x + jitter(rand, 1.2 * wobble), y + jitter(rand, 1.2 * wobble));
  ctx.rotate((options.rot || 0) + jitter(rand, 0.004 * wobble));
  if (options.scale !== undefined) ctx.scale(options.scale, options.scale);
  const reveal = options.reveal ?? 1;
  if (reveal <= 0) {
    ctx.restore();
    return;
  }
  if (reveal < 1) {
    const width = ctx.measureText(text).width;
    const left = ctx.textAlign === "center" ? -width / 2 : ctx.textAlign === "right" ? -width : 0;
    ctx.beginPath();
    ctx.rect(left - 20, -options.size * 1.5, (width + 40) * reveal, options.size * 2.5);
    ctx.clip();
  }
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function paper(color = C.paper) {
  ctx.setTransform(PIXEL_SCALE, 0, 0, PIXEL_SCALE, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}

// Zoom about a focus point, with optional roll and per-frame shake.
function camera(options = {}) {
  const zoom = options.zoom ?? 1;
  const shake = options.shake || 0;
  const rand = mulberry32(frameIndex * 31 + 7);
  ctx.setTransform(PIXEL_SCALE, 0, 0, PIXEL_SCALE, 0, 0);
  ctx.translate(W / 2 + jitter(rand, shake), H / 2 + jitter(rand, shake));
  ctx.rotate(options.rot || 0);
  ctx.scale(zoom, zoom);
  ctx.translate(-(options.x ?? W / 2), -(options.y ?? H / 2));
}

function flash(alpha, color = C.white) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.setTransform(PIXEL_SCALE, 0, 0, PIXEL_SCALE, 0, 0);
  ctx.globalAlpha = clamp(alpha);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Landscape keeps its literal numbers; portrait swaps in its own layout table.
const byFormat = (landscape, portrait) => (PORTRAIT ? portrait : landscape);
// TikTok/Reels UI keeps clear of this band (the job-hunt edits use the same values). Kit globals share one page
// with the overlay engines, whose ui.js already declares SAFE and wrapLines, hence the distinct names.
const PHONE_SAFE = { top: 270, bottom: 1248, left: 65, right: 1015, columnTop: 880, columnRight: 940 };

// Greedy word wrap; measured at draw time because textWidth needs the live context.
function wrapWords(text, options, maxWidth) {
  const lines = [];
  for (const word of text.split(" ")) {
    const joined = lines.length ? `${lines.at(-1)} ${word}` : word;
    if (lines.length && textWidth(joined, options) <= maxWidth) lines[lines.length - 1] = joined;
    else lines.push(word);
  }
  return lines;
}

// Wrapped text under one font; a reveal wipes the lines in one after another. Returns the line count.
function drawWrapped(text, x, y, options, lineHeight) {
  const { reveal = 1, ...font } = options;
  const lines = wrapWords(text, font, font.maxWidth);
  lines.forEach((line, index) => drawText(line, x, y + index * lineHeight, { ...font, reveal: clamp(reveal * lines.length - index) }));
  return lines.length;
}
// ?scale=2 on a vertical page draws the same layout at 2160x3840 (4K TikTok/Reels uploads, sharper text).
const PIXEL_SCALE = PORTRAIT && new URLSearchParams(location.search).get("scale") === "2" ? 2 : 1;
