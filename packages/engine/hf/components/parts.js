// Created by The Angelo Umali.
// Pieces every brand kind shares, drawn by the canvas page's own code (brand/canvas.js): the lifted card with its shadow,
// gold accent, lines that draw on with a riding node, rising words and kickers, the woven Z, pen-written type.
// Layout and timing constants are the canvas's. Each returns { html, motion }; names become CSS classes, unique in a cue.
const { canvasBrand, SETTLED } = require("../brand/canvas");
const { unit, box, drawable } = require("../brand/html");
const { rise, pop, show, hide } = require("../fx/motion");
const { cardLift, cardIn, cardOut, styleOf } = require("../fx/paper");
const { scrim } = require("../fx/light");
const { drawOn, glow, penReveal } = require("../fx/ink");
const { words, tracking, swipe } = require("../fx/kinetic");
const { spring } = require("../fx/springs");

const canvas = canvasBrand();
const k = canvas.scope;
const PULSE_EVERY = 1.6; // a gold node rings again this long after its last ring ends
const SETTLED_RISE = { alpha: 1, dy: 0, scale: 1, progress: 1 };
const NOTHING = { html: "", motion: [] };
const idOf = (cue, name) => `s${cue.seed}-${name}`;
const join = (...parts) => ({ html: parts.map((part) => part.html).join(""), motion: parts.flatMap((part) => part.motion) });
const still = (cue, name, draw, options) => canvas.svg(cue.seed, idOf(cue, name), draw, options);
// One unit drawn by the canvas; `name` is its class and clip-id prefix. `pre` hides it until a keyframed tween shows it;
// other options go to the canvas draw (`active`).
const drawn = (cue, name, draw, origin, { pre = false, inner = "", ...options } = {}) =>
  unit(pre ? `${name} pre` : name, still(cue, name, draw, options), origin, inner);

// What a canvas helper drew after `head` (goldRule's node after its line), so the two can move apart.
function after(head, full, what) {
  if (!full.startsWith(head)) throw new Error(`${what} no longer draws its parts in the order hf/ splits them`);
  return full.slice(head.length);
}

// A line drawing on from `at` (the standard spring, the canvas's springAt(local - at)) with its node riding the tip.
// drawAt(s, withNode) draws the line alone, or the line then its node. `appear` brings the node in; a glow ring follows,
// and keeps ringing until `pulseUntil` when given.
function lineWithNode(cue, name, [x, y], length, drawAt, at, { appear = show, glowColour, pulseUntil } = {}) {
  const line = still(cue, name, (s) => drawAt(s, false));
  const node = after(
    line,
    still(cue, name, (s) => drawAt(s, true)),
    name,
  );
  const tip = [x + length, y];
  const travel = spring();
  const ring =
    node && glowColour
      ? drawn(cue, `${name}-glow`, (s) => s.sketchEllipse(...tip, 14, 14, { color: glowColour, width: 3, passes: 1 }), tip, { pre: true })
      : "";
  return {
    html: unit(`${name}-line`, drawable(line), [x, y]) + (node && unit(`${name}-node`, node, tip)) + ring,
    motion: [
      drawOn(`.${name}-line path`, at, travel),
      ...(node ? [{ target: `.${name}-node`, at, from: { x: -length }, to: { x: 0, ...travel } }, appear(`.${name}-node`, at)] : []),
      ...(ring ? [glow(`.${name}-glow`, ringAt(at, travel), ringRepeat(at, travel, pulseUntil))] : []),
    ],
  };
}

const ringAt = (at, travel) => at + travel.duration * 0.6;
const ringRepeat = (at, travel, until) =>
  until ? { repeat: Math.max(0, Math.floor((until - ringAt(at, travel) - 0.5) / (0.5 + PULSE_EVERY))), repeatDelay: PULSE_EVERY } : {};

// A canvas goldRule, its line drawing on from `at` and its node riding the tip and glowing as it lands. `pulseUntil`
// keeps the node ringing while the card is up.
const goldRule = (cue, name, x, y, width, at, { pulseUntil, ...options } = {}) =>
  lineWithNode(cue, name, [x, y], width, (s, withNode) => s.goldRule(x, y, width, 1, { ...options, node: withNode && options.node !== false }), at, {
    glowColour: options.color ?? k.goldRuleColour(options.onFootage),
    pulseUntil,
  });

// A card at page rect [x, y, w, h] as brandCard draws it (shadow and sheet frozen on the cue seed); `content`
// ({ html, motion }) draws in card space. A top-level card (`duration` given) enters in its seeded style (or `style`),
// sits in a warm glow on a dimming scrim, and returns its own exit; a card inside a card keeps the short lift. `accent`
// adds brandCard's gold rule along the top edge. `lift: false` leaves the entrance to the kind (the chapter card's wipe).
function card(
  cue,
  name,
  rect,
  content,
  { tone = "paper", fill, edge, edgeWidth, accent = false, at = 0, lift = true, preset, duration, style, dim = 0.55 } = {},
) {
  const [, , w, h] = rect;
  const colours = k.CARD_TONES[tone];
  const sheetFill = fill ?? colours.fill;
  const layers = canvas.still(cue.seed, idOf(cue, name), (s, capture) => ({
    shadow: capture(() => s.dropShadow(s.rectPoints(0, 0, w, h))),
    sheet: capture(() => s.cardSheet(0, 0, w, h, { fill: sheetFill, edge: edge ?? colours.edge, width: edgeWidth })),
  }));
  const bold = duration !== undefined;
  const [length, ruleOptions] = k.cardAccentRule(w, { tone, fill: sheetFill });
  const rule = accent ? goldRule(cue, `${name}-accent`, 0, 0, length, at + 0.15, { ...ruleOptions, pulseUntil: bold ? duration : undefined }) : NOTHING;
  const body = unit("shadow", layers.shadow) + unit("face", layers.sheet) + content.html + rule.html;
  const motion = [...rule.motion, ...content.motion];
  if (!bold) return { html: box(name, rect, body), motion: [...(lift ? cardLift(`.${name}`, at, { preset }) : []), ...motion], exit: [] };
  const way = styleOf(cue, style);
  const dark = dim ? scrim(`${name}-scrim`, rect, at, duration, { strength: dim }) : NOTHING;
  return {
    html: dark.html + box(name, rect, `<div class="glow${tone === "ink" ? " on-ink" : ""}"></div>` + body),
    motion: [...dark.motion, ...(lift ? cardIn(`.${name}`, at, way, rect) : []), ...motion],
    exit: lift ? cardOut(`.${name}`, duration, way, rect) : [],
  };
}

// The pieces a canvas line helper lays out (each word wordsRise places, each line linesRise sets), one unit each with
// class `${name} w`, rising out of a blur on its stagger.
function rising(cue, name, draw, at, { step = 0.1, distance = 18 } = {}) {
  const placed = canvas.pieces(cue.seed, idOf(cue, name), "riseText", draw);
  return {
    html: placed.map(({ args: [, x, baseline], svg }) => unit(`${name} w`, svg, [x, baseline])).join(""),
    motion: words(`.${name}.w`, at, { step, distance }),
  };
}
const risingWords = (cue, name, text, x, y, font, at, options = {}) =>
  rising(cue, name, (s) => s.wordsRise(text, x, y, font, SETTLED, 0, options), at, { step: options.step, distance: options.distance });

// One canvas riseText (a sub line, a role) rising at `at`.
const risingText = (cue, name, text, x, y, font, at, options = {}, { distance = 14 } = {}) => ({
  html: drawn(cue, name, (s) => s.riseText(text, x, y, font, SETTLED_RISE, options), [x, y]),
  motion: rise(`.${name}`, at, { distance, scaleFrom: 1 }),
});

// A canvas kicker rising at `at`; on a card its tracking settles from wide (0.3 em) to the kicker's 0.18 em.
function kicker(cue, name, text, x, y, at, options = {}) {
  const size = options.size ?? k.TYPE.kicker.size;
  const settle = options.onFootage || options.index !== undefined ? [] : [tracking(`.${name} text`, at, 0.3 * size, k.TYPE.kicker.trackingEm * size)];
  return {
    html: drawn(cue, name, (s) => s.kicker(text, x, y, SETTLED, 0, options), [x, y]),
    motion: [...rise(`.${name}`, at, { distance: 18, scaleFrom: 1 }), ...settle],
  };
}

// Card head (drawHead): the kicker from 0.1 s and the serif title rising word by word from 0.2 s, in card space.
const head = (cue, kickerText, title, layout) =>
  join(
    kickerText ? kicker(cue, "head-kicker", kickerText, k.CARD_PAD, k.HEAD_KICKER, 0.1) : NOTHING,
    title ? risingWords(cue, "head-title", title, k.CARD_PAD, layout.titleBaseline, layout.titleFont, 0.2) : NOTHING,
  );

// Type a pen writes on over `span`, through strokedText's reveal window: outlined footage type, or `plain` kit drawText (a
// hand label on a card or in a bubble), which the same window covers.
function written(cue, name, text, x, baseline, font, span, { plain = false, ...options } = {}) {
  // drawText shrinks plain type to its maxWidth, so the window covers the fitted size, as the canvas reveal does.
  const fitted = plain && options.maxWidth ? { ...font, size: k.fitFontSize(text, { ...font, ...options }, options.maxWidth) } : font;
  const [left, top, width, height] = k.strokedRevealBox(text, fitted, options.align ?? "left");
  return {
    html: drawn(cue, name, plain ? (s) => s.drawText(text, x, baseline, { ...font, ...options }) : (s) => s.strokedText(text, x, baseline, font, options)),
    motion: [penReveal(`.${name}`, span, [x + left, baseline + top, x + left + width, baseline + top + height])],
  };
}

// The woven Z on brandZTiming from `start` (drawBrandZ, top-left x, y): the steel node pops, the bars draw on over their
// Z_BEATS windows, the gold node pops with the kit logo's glow ring (1.3 to 1.9 node radii).
function zMark(cue, name, x, y, height, start) {
  const scale = height / k.Z_LOGO.height;
  const point = ([logoX, logoY]) => [x + logoX * scale, y + logoY * scale];
  const bar = (piece, options) => unit(`${name}-${piece}`, drawable(still(cue, `${name}-${piece}`, (s) => s.drawBrandZ(x, y, height, options))));
  const node = (piece, options, at) => drawn(cue, `${name}-${piece}`, (s) => s.drawBrandZ(x, y, height, options), at);
  const [steelNode, goldNode] = [point(k.Z_LOGO.tealNode), point(k.Z_LOGO.goldNode)];
  const ringRadius = k.Z_LOGO.nodeRadius * scale * 1.3;
  const { steel, gold, goldNode: goldAt, glow: glowFor } = k.Z_BEATS;
  const window = ([from, to]) => ({ duration: to - from, ease: "power2.inOut" });
  return {
    html:
      bar("steel", { steel: 1 }) +
      bar("gold", { gold: 1 }) +
      node("snode", { steelNode: 1 }, steelNode) +
      node("gnode", { goldNode: 1 }, goldNode) +
      drawn(cue, `${name}-glow`, (s) => s.sketchEllipse(...goldNode, ringRadius, ringRadius, { color: k.BRAND.logoGold, width: 3 }), goldNode, { pre: true }),
    motion: [
      pop(`.${name}-snode`, start),
      drawOn(`.${name}-steel path`, start + steel[0], window(steel)),
      drawOn(`.${name}-gold path`, start + gold[0], window(gold)),
      pop(`.${name}-gnode`, start + goldAt),
      glow(`.${name}-glow`, start + goldAt, { duration: glowFor, fromScale: 1, scale: 1.9 / 1.3, fromOpacity: 1 }),
    ],
  };
}

// A goldBright marker band behind [x, top, w, h] that swipes in from its left edge: an accent word on paper.
const highlighter = (cue, name, [x, top, w, h], at) => ({
  html: drawn(cue, name, (s) => s.wobblyFill(s.rectPoints(x, top, w, h), k.BRAND.goldBright, 0.3), [x, top + h / 2]),
  motion: [swipe(`.${name}`, at)],
});

// An arrow that draws on over [start, end] and gets its head at the end, as the canvas draws it (the head only once
// complete). drawAt(s, progress) draws it in the canvas scope.
const arrow = (cue, name, drawAt, [start, end]) => ({
  html: unit(`${name}-body`, drawable(still(cue, name, (s) => drawAt(s, 0.9999)))) + drawn(cue, `${name}-full`, (s) => drawAt(s, 1), [0, 0], { pre: true }),
  motion: [drawOn(`.${name}-body path`, start, { duration: end - start, ease: "none" }), show(`.${name}-full`, end), hide(`.${name}-body`, end)],
});

// Text typed at `cps` from `start`, as the canvas typeOn draws it: a window opens one letter at a time over the whole line,
// and the cursor steps after the last letter, then blinks (on for the first half of every 0.5 s) until `until`.
function typed(cue, name, text, left, baseline, font, start, until, { cps, color }) {
  const xAt = (count) => left + k.textWidth(text.slice(0, count), font);
  const counts = Array.from({ length: text.length }, (_, index) => index + 1);
  const [top, bottom] = [baseline - font.size * 1.2, baseline + font.size * 0.4];
  const window = (right) => `polygon(${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px)`;
  const step = { duration: 1 / cps, ease: "steps(1)" };
  const done = start + text.length / cps;
  const glyphs = (characters) => (s) => s.drawText(characters, left, baseline, { ...font, color, wobble: 0.2 });
  return {
    html: drawn(cue, name, glyphs(text), [left, baseline], { pre: true }) + drawn(cue, `${name}-cursor`, glyphs("_"), [left, baseline], { pre: true }),
    motion: [
      {
        target: `.${name}`,
        at: start,
        to: { keyframes: [{ opacity: 1, clipPath: window(left), duration: 0 }, ...counts.map((count) => ({ clipPath: window(xAt(count)), ...step }))] },
      },
      {
        target: `.${name}-cursor`,
        at: start,
        to: { keyframes: [{ opacity: 1, x: 0, duration: 0 }, ...counts.map((count) => ({ x: xAt(count) - left, ...step }))] },
      },
      // One switch per quarter second: a stepped yoyo jumps back on as each reverse half starts, so it never shows off.
      ...Array.from({ length: Math.max(0, Math.floor((until - done) / 0.25)) }, (_, index) => {
        const visible = index % 2 === 1;
        return {
          target: `.${name}-cursor`,
          at: done + 0.25 * (index + 1),
          from: { opacity: visible ? 0 : 1 },
          to: { opacity: visible ? 1 : 0, duration: 0.001, ease: "none", immediateRender: false },
        };
      }),
    ],
  };
}

// An ink avatar disc with a gold node ({ x, y, radius, at }), popping in at `at`.
const avatarDisc = (cue, name, { x, y, radius, at }) => ({
  html: drawn(
    cue,
    name,
    (s) => {
      s.sketchEllipse(x, y, radius, radius, { fill: k.BRAND.ink, stroke: false });
      s.sketchEllipse(x, y, radius * 0.35, radius * 0.35, { fill: k.BRAND.gold, stroke: false });
    },
    [x, y],
  ),
  motion: [pop(`.${name}`, at)],
});

// A panel-wide card in the top band (canvas panelCard), its top `y` clamped by bandTop.
const panelCard = (cue, y, height, content, options) => card(cue, "card", [k.SAFE.left, k.bandTop(y, height), k.PANEL_W, height], content, options);

module.exports = {
  k,
  SETTLED,
  SETTLED_RISE,
  NOTHING,
  idOf,
  join,
  still,
  drawn,
  after,
  lineWithNode,
  goldRule,
  card,
  rising,
  risingWords,
  risingText,
  kicker,
  head,
  written,
  zMark,
  highlighter,
  arrow,
  typed,
  avatarDisc,
  panelCard,
};
