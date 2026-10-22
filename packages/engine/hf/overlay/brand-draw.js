// Created by The Angelo Umali.
// Brand drawing helpers (spec §2.3, §4, §5.1-5.3): tracked type, the kicker, gold rule, circuit nodes, the woven Z
// and the card. Furniture draws under stillInk so it holds still while doodles keep their boil.

// Seed of the cue being drawn; hf/brand/canvas.js sets it so furniture freezes without threading a seed through every call.
let drawingCueSeed = null;

// Frozen boil: a fixed boilStep and a fresh seedCounter repeat the same wobble every frame. Restoring the counter
// keeps later live strokes on their own seeds whether or not this draw ran.
function stillInk(seed, draw) {
  if (seed == null) return draw();
  const outerStep = boilStep;
  const outerCounter = seedCounter;
  boilStep = seed;
  seedCounter = 0;
  try {
    return draw();
  } finally {
    boilStep = outerStep;
    seedCounter = outerCounter;
  }
}

// Furniture and brand text of the cue being drawn hold still; only draw-on strokes move (spec §4.2).
const drawStill = (draw) => stillInk(drawingCueSeed, draw);

// Kit drawings hard-code some palette entries (drawZLogo's teal/gold, the clock hand, the rocket): swap them for one
// draw, always restored.
function withKitColors(colors, draw) {
  const outer = Object.fromEntries(Object.keys(colors).map((name) => [name, C[name]]));
  Object.assign(C, colors);
  try {
    return draw();
  } finally {
    Object.assign(C, outer);
  }
}

// Draws each layer from the same seed, so an ink under-stroke and its gold stroke share one wobble.
function sameSeed(layers, drawLayer) {
  const counter = seedCounter;
  layers.forEach((layer) => {
    seedCounter = counter;
    drawLayer(layer);
  });
}

// Canvas measures the trailing letter space too; the visible width leaves it out.
const trackedWidth = (text, font, trackingEm) => textWidth(text, { ...font, tracking: trackingEm * font.size }) - trackingEm * font.size;

// applyFont never resets letterSpacing, so it is restored explicitly; centre/right shift by the trailing space.
function trackedText(text, x, y, font, trackingEm, options = {}) {
  const tracking = trackingEm * font.size;
  const align = options.align ?? "left";
  const shift = align === "center" ? tracking / 2 : align === "right" ? tracking : 0;
  const outerSpacing = ctx.letterSpacing;
  try {
    drawText(text, x + shift, y, { wobble: 0.2, ...font, ...options, tracking });
  } finally {
    ctx.letterSpacing = outerSpacing;
  }
}

// Eyebrow: optional mono index, then Inter caps at 0.18 em. On footage it sits on an ink tab whose left edge is x.
// Returns the drawn width (tab included). Tracked caps never get an outline: it fills them in.
function kicker(text, x, y, local, start, { index, onFootage = false, color = onFootage ? BRAND.goldBright : BRAND.muted, size = TYPE.kicker.size } = {}) {
  const font = { ...TYPE.kicker, size };
  const indexFont = { ...TYPE.mono, size };
  const caps = text.toUpperCase();
  const indexWidth = index === undefined ? 0 : trackedWidth(String(index), indexFont, 0.16) + size * 0.7;
  const pad = onFootage ? 14 : 0;
  const width = pad * 2 + indexWidth + trackedWidth(caps, font, font.trackingEm);
  const rise = riseIn(local, start, { distance: 18, scaleFrom: 1 });
  if (rise.alpha <= 0) return width;
  ctx.save();
  ctx.globalAlpha *= rise.alpha;
  ctx.translate(0, rise.dy);
  const capHeight = size * 0.73;
  if (onFootage) drawStill(() => sketchRect(x, y - capHeight - 8, width, capHeight + 16, { fill: BRAND.ink, stroke: false }));
  if (index !== undefined) trackedText(String(index), x + pad, y, indexFont, 0.16, { color: onFootage ? BRAND.steelOnInk : BRAND.lineStrong, wobble: 0 });
  trackedText(caps, x + pad + indexWidth, y, font, font.trackingEm, { color, wobble: 0 });
  ctx.restore();
  return width;
}

// Circuit node shaped like the logo's (inner:outer 64:144): the ring spans 0.44r-r and `surface` fills the hole.
function nodeRing(x, y, radius, { color = BRAND.steel, pop = 1, surface = null } = {}) {
  if (pop <= 0) return;
  const outer = radius * pop;
  if (surface) sketchEllipse(x, y, outer * 0.5, outer * 0.5, { fill: surface, stroke: false });
  sketchEllipse(x, y, outer * 0.72, outer * 0.72, { color, width: outer * 0.56, passes: 1, rough: 0.6 });
}

const goldRuleColour = (onFootage) => (onFootage ? BRAND.goldBright : BRAND.gold);

// Gold rule sweep with a node riding its tip (spec §5.2); still furniture once grown. At most one per card.
// On footage it is goldBright over an ink under-stroke 6 px wider.
function goldRule(
  x,
  y,
  width,
  progress,
  { onFootage = false, color = goldRuleColour(onFootage), thickness = 5, node = true, surface = onFootage ? BRAND.ink : BRAND.paper } = {},
) {
  if (progress <= 0) return;
  const tipX = x + width * progress;
  const layers = onFootage ? [{ color: BRAND.ink, grow: 6, alpha: 0.9 }] : [];
  layers.push({ color, grow: 0, alpha: 1 });
  const draw = () => {
    sameSeed(layers, (layer) =>
      sketchLine(x, y, tipX, y, { color: layer.color, width: thickness + layer.grow, alpha: layer.alpha, passes: 1, rough: 0.8, overshoot: 0 }),
    );
    if (node) sameSeed(layers, (layer) => nodeRing(tipX, y, 1.6 * thickness + layer.grow / 2, { color: layer.color, surface }));
  };
  if (progress >= 0.99) drawStill(draw);
  else draw();
}

const Z_PALETTES = { master: { teal: BRAND.logoSteel, gold: BRAND.logoGold }, token: { teal: BRAND.steel, gold: BRAND.gold } };

// Woven Z (spec §5.1), top-left at (x, y). Draw it on paper only: the master steel is 2.3:1 on ink.
function drawBrandZ(x, y, height, { steel = 0, gold = 0, steelNode = 0, goldNode = 0, glow = 0, palette = "master" } = {}) {
  withKitColors(Z_PALETTES[palette], () =>
    drawStill(() => drawZLogo(x, y, height / Z_LOGO.height, { teal: steel, gold, tealNode: steelNode, goldNode, glowGold: glow })),
  );
}

const CARD_TONES = {
  paper: { fill: BRAND.paper, edge: BRAND.lineStrong },
  white: { fill: BRAND.white, edge: BRAND.lineStrong },
  ink: { fill: BRAND.ink, edge: BRAND.ink },
};

// A card's sheet: fill and a still single-pass edge (spec §1.4, §4.2). hf/ draws it apart from the shadow it lifts.
const cardSheet = (x, y, w, h, { fill, edge, width = 3.5 }) => sketchRect(x, y, w, h, { fill, color: edge, width, passes: 1, rough: 1, overshoot: 0 });
// The gold accent along a card's top edge from its left corner: [length, goldRule options].
const cardAccentRule = (w, { tone, fill }) => [Math.min(240, w * 0.4), { onFootage: tone === "ink", surface: fill }];

// Opaque card; `accent` is the draw-on progress of its gold accent rule.
function brandCard(x, y, w, h, { tone = "paper", accent = 0, seed = drawingCueSeed, fill = CARD_TONES[tone].fill, edge = CARD_TONES[tone].edge, width } = {}) {
  stillInk(seed, () => {
    dropShadow(rectPoints(x, y, w, h));
    cardSheet(x, y, w, h, { fill, edge, width });
  });
  const [length, options] = cardAccentRule(w, { tone, fill });
  goldRule(x, y, length, accent, options);
}
