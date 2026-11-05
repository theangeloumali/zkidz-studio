// Created by The Angelo Umali.
// tradeScreen (storyboard 12): seeded candles stream left under a riding last-price tag. Illustrative only, so no prices,
// figures or ticker anywhere (Angelo chose generic money UIs).
const { unit } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { canvasBrand } = require("../../brand/canvas");
const { rise } = require("../../fx/motion");
const { glow } = require("../../fx/ink");
const { LEARNING } = require("../../learning/tokens");
const { microLabel, fadeOut, glideTrack } = require("./typing");

const { shade: S } = LEARNING;
const { mulberry32 } = canvasBrand().scope;
const T = { w: 960, h: 380, chartX: 30, chartY: 66, chartW: 770, chartH: 300, visible: 34, every: 0.35, grow: 0.25 };

// A seeded walk that chases a rise with one dip and its recovery, so the card reads "a market", never a real one.
function market(seed, count) {
  const rand = mulberry32(seed * 7919 + 13);
  const shape = (share) => 50 + 26 * share - 16 * Math.exp(-(((share - 0.65) / 0.08) ** 2));
  let value = shape(0);
  return Array.from({ length: count }, (_, index) => {
    const open = value;
    const close = open + (shape(index / (count - 1)) - open) * 0.45 + (rand() - 0.5) * 3.5;
    value = close;
    return { open, close, high: Math.max(open, close) + rand() * 2.5, low: Math.min(open, close) - rand() * 2.5 };
  });
}

// The y offset and scale that fit candles [first, last] into the chart band, like a trading app's auto-scale.
function fitOf({ series, toY }, first, last) {
  const window = series.slice(Math.max(0, first), last + 1);
  const [top, bottom] = [Math.min(...window.map((c) => toY(c.high))), Math.max(...window.map((c) => toY(c.low)))];
  const scaleY = (T.chartH - 40) / (bottom - top);
  return { y: 20 - top * scaleY, scaleY };
}

function layout(cue, duration) {
  const fresh = Math.ceil(duration / T.every) + 1;
  const series = market(cue.seed, T.visible + fresh);
  const [min, max] = [Math.min(...series.map((c) => c.low)), Math.max(...series.map((c) => c.high))];
  const toY = (value) => T.chartH - 20 - ((value - min) / (max - min)) * (T.chartH - 40);
  const step = T.chartW / T.visible;
  return { series, toY, step, fresh, x: cue.x ?? 60, y: cue.y ?? 196 };
}

function candles({ series, toY, step }) {
  return series
    .map((c, index) => {
      const up = c.close >= c.open;
      const colour = up ? LEARNING.accent : S.down;
      const cx = index * step + step / 2;
      const [top, bottom] = [toY(Math.max(c.open, c.close)), toY(Math.min(c.open, c.close))];
      return (
        `<g class="ts-c${index}"><line x1="${num(cx)}" x2="${num(cx)}" y1="${num(toY(c.high))}" y2="${num(toY(c.low))}" stroke="${colour}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>` +
        `<rect x="${num(cx - step * 0.32)}" y="${num(top)}" width="${num(step * 0.64)}" height="${num(Math.max(3, bottom - top))}" rx="2" fill="${colour}"/></g>`
      );
    })
    .join("");
}

const tradeScreen = {
  sfx: () => [{ at: 0, sound: "swish" }],
  render(cue, { duration }) {
    const placed = layout(cue, duration);
    const { series, toY, step, fresh, x, y } = placed;
    const line = series.map((c, index) => `${num(index * step + step / 2)},${num(toY((c.open + c.close) / 2))}`).join(" ");
    const grid = [0, 1, 2, 3, 4]
      .map((row) => `<line x1="0" x2="${T.chartW}" y1="${20 + row * 65}" y2="${20 + row * 65}" stroke="${LEARNING.paper}" stroke-opacity="0.08"/>`)
      .join("");
    const scale = [0, 1, 2, 3, 4]
      .map(
        (row) =>
          `<rect x="${T.chartX + T.chartW + 18}" y="${T.chartY + 18 + row * 65}" width="${36 + (row % 2) * 14}" height="5" rx="2.5" fill="${LEARNING.paper}" fill-opacity="0.22"/>`,
      )
      .join("");
    const width = series.length * step;
    const now = (index) => (index - T.visible) * T.every; // when candle `index` reaches the right edge
    const strip =
      `<div class="u ts-strip"><div class="ts-fit" style="position:absolute;left:0;top:0;transform-origin:0 0">` +
      `<svg width="${num(width)}" height="${T.chartH}" style="position:absolute;left:0;top:0;overflow:visible">${candles(placed)}` +
      `<polyline points="${line}" fill="none" stroke="${LEARNING.accentInk}" stroke-width="3" stroke-linejoin="round" stroke-opacity="0.9" vector-effect="non-scaling-stroke"/></svg></div></div>`;
    const chart =
      `<div style="position:absolute;left:${T.chartX}px;top:${T.chartY}px;width:${T.chartW}px;height:${T.chartH}px;overflow:hidden">` +
      `<svg width="${T.chartW}" height="${T.chartH}" style="position:absolute;left:0;top:0">${grid}</svg>${strip}</div>`;
    const fitAt = (index) => fitOf(placed, index - T.visible + 1, index);
    const closeY = (index) => T.chartY + fitAt(index).y + fitAt(index).scaleY * toY(series[index].close);
    const tagX = T.chartX + T.chartW + 6;
    const tag =
      `<line x1="${T.chartX}" x2="${tagX}" y1="0" y2="0" stroke="${LEARNING.accentInk}" stroke-width="2" stroke-dasharray="6 8"/>` +
      `<rect x="${tagX}" y="-22" width="96" height="44" rx="10" fill="${LEARNING.accentInk}"/>` +
      `<rect x="${tagX + 36}" y="-4" width="44" height="8" rx="4" fill="#FFFFFF" fill-opacity="0.85"/>`;
    const head =
      `<circle class="ts-live" cx="${T.chartX + 6}" cy="34" r="12" fill="${LEARNING.bad}" fill-opacity="0.3"/><circle cx="${T.chartX + 6}" cy="34" r="6" fill="${LEARNING.bad}"/>` +
      microLabel("Live", T.chartX + 26, 42, LEARNING.paper);
    const card =
      `<div class="box ts" style="left:${num(x)}px;top:${num(y)}px;width:${T.w}px;height:${T.h}px;border-radius:30px;overflow:hidden;` +
      `background:linear-gradient(160deg,${S.dark},${S.darkLow});box-shadow:${S.shadow},inset 0 0 0 1px rgba(255,255,255,.08)">` +
      unit("ts-head", head) +
      `<svg width="${T.w}" height="${T.h}" style="position:absolute;left:0;top:0">${scale}</svg>` +
      chart +
      unit("ts-tag", tag, [0, 0], unit("ts-blink", `<circle cx="${tagX + 20}" cy="0" r="7" fill="#FFFFFF"/>`)) +
      `</div>`;
    const pops = series.map((_, index) => index).filter((index) => index >= T.visible && now(index) < duration);
    // As each new candle lands the scale refits to the window on screen and the tag rides its close.
    const landed = (props) => pops.map((index) => [now(index) + T.grow, props(index)]);
    const bottom = (index) => `${num(index * step + step / 2)} ${num(toY(Math.min(series[index].open, series[index].close)))}`;
    return {
      html: card,
      motion: [
        ...rise(".ts", 0, { distance: 30 }),
        // A ticker scrolls at a constant rate: linear is the honest motion here, not an ease.
        { target: ".ts-strip", at: 0, from: { x: 0 }, to: { x: -(duration / T.every) * step, duration, ease: "none" } },
        ...pops.map((index) => ({
          target: `.ts-c${index}`,
          at: now(index),
          from: { scaleY: 0, svgOrigin: bottom(index) },
          to: { scaleY: 1, svgOrigin: bottom(index), duration: T.grow, ease: "power3.out" },
        })),
        glideTrack(
          ".ts-tag",
          { y: closeY(T.visible - 1) },
          landed((index) => ({ y: closeY(index) })),
          { glide: 0.2 },
        ),
        glideTrack(".ts-fit", fitAt(T.visible - 1), landed(fitAt), { glide: 0.2 }),
        {
          target: ".ts-blink",
          at: 0,
          from: { opacity: 1 },
          to: { opacity: 0.2, duration: 0.45, ease: "power1.inOut", repeat: Math.max(0, Math.floor(duration / 0.45) - 1), yoyo: true },
        },
        glow(".ts-live", 0.2, { scale: 1.8, fromScale: 1, repeatDelay: 0.6, until: duration }),
      ],
      exit: fadeOut(".ts", duration),
    };
  },
};

module.exports = { tradeScreen };
