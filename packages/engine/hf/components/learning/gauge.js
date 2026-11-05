// Created by The Angelo Umali.
// meterGauge (storyboard 05): a warm instrument card whose LOW / MID / HIGH zones draw on, then a needle that kicks up and
// settles on `level` with a soft overshoot at `settleAt`, while its tag ("BURNOUT · RARELY") pops in.
const { unit, drawable } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { rise, fade } = require("../../fx/motion");
const { drawOn } = require("../../fx/ink");
const { LEARNING } = require("../../learning/tokens");
const { glyph, microLabel, fadeOut } = require("./typing");
const { chip, chipBox } = require("./chips");

const { shade: S } = LEARNING;
const CARD = { w: 740, h: 404, radius: 36, cx: 370, cy: 332, r: 200, band: 46 };
const MONO = { ...LEARNING.type.mono, weight: 600 };
const KICK = { lead: 0.95, earliest: 0.05, rise: 0.37, past: 60, floor: 95 };

const point = (degrees, r = CARD.r) => [CARD.cx - r * Math.cos((degrees * Math.PI) / 180), CARD.cy - r * Math.sin((degrees * Math.PI) / 180)];
function arc(from, to, r = CARD.r) {
  const [[x1, y1], [x2, y2]] = [point(from, r), point(to, r)];
  return `M${num(x1)} ${num(y1)} A${r} ${r} 0 0 1 ${num(x2)} ${num(y2)}`;
}

function needle(className, opacity) {
  const [[tx, ty], [lx, ly], [rx, ry]] = [point(0, CARD.r - 34), point(90, 14), point(-90, 14)];
  const shape = `<polygon points="${num(tx)},${num(ty)} ${num(lx)},${num(ly)} ${num(rx)},${num(ry)}" fill="${LEARNING.ink}" fill-opacity="${opacity}"/>`;
  return unit(className, shape, [CARD.cx, CARD.cy]);
}

// The swing as one rotation track: up past the level, then down onto it, ending exactly on the pin. A ghost (`lag` > 0)
// trails it by `lag` and fades out as it lands.
function swing(target, at, settleAt, level, lag = 0) {
  const span = settleAt - at;
  const kick = Math.min(175, Math.max(level + KICK.past, KICK.floor));
  const ghost = lag
    ? [
        { rotation: 0, opacity: 1, duration: 0 },
        { rotation: 0, duration: lag },
      ]
    : [{ rotation: 0, duration: 0 }];
  return {
    target,
    at,
    to: {
      keyframes: [
        ...ghost,
        { rotation: kick, duration: span * KICK.rise, ease: "power2.out" },
        { rotation: level, ...(lag ? { opacity: 0 } : {}), duration: span * (1 - KICK.rise), ease: "back.out(1.7)" },
      ],
    },
  };
}

function layout(cue) {
  const name = cue.label ?? cue.tag ?? "meterGauge";
  if (!(cue.level >= 0 && cue.level <= 1)) throw new Error(`meterGauge "${name}": level is a share in [0, 1], not ${cue.level}`);
  const settleAt = cue.settleAt ?? 1.0;
  if (settleAt < 0.35) throw new Error(`meterGauge "${name}": settleAt ${settleAt} leaves the needle no time to swing`);
  return { name, settleAt, kickAt: Math.max(KICK.earliest, settleAt - KICK.lead), left: (cue.x ?? 540) - CARD.w / 2, top: cue.y ?? 136 };
}

// The ink status chip in the card's top right, an orange dot before its caps, popping in as the needle settles.
const TAG = { size: 28, right: 22, top: 18 };
function tag(text, at) {
  const { width } = chipBox(text, TAG.size, true);
  const left = CARD.w - TAG.right - width;
  if (left < 230) throw new Error(`meterGauge tag "${text}" is ${width} px wide; the card holds ${CARD.w - 252}`);
  return chip("mg-tag", { text, tone: "ink", dot: LEARNING.accentInk }, [left, TAG.top], { size: TAG.size, at });
}

const meterGauge = {
  sfx(cue) {
    const { settleAt, kickAt } = layout(cue);
    return [
      { at: 0.15, sound: "pencil", dur: 0.45 },
      { at: kickAt, sound: "swish" },
      { at: settleAt, sound: "tick" },
    ];
  },
  render(cue, { duration }) {
    const { settleAt, kickAt, left, top } = layout(cue);
    const level = cue.level * 180;
    const zone = (from, to, colour) => `<path d="${arc(from, to)}" fill="none" stroke="${colour}" stroke-width="${CARD.band}"/>`;
    const ticks = Array.from({ length: 19 }, (_, index) => {
      const [[x1, y1], [x2, y2]] = [point(index * 10, CARD.r - 40), point(index * 10, CARD.r - (index % 3 ? 52 : 62))];
      return `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${LEARNING.ink}" stroke-width="${index % 3 ? 2 : 4}" stroke-opacity="0.55"/>`;
    }).join("");
    const end = { ...MONO, size: 30 };
    const [[lowX], [highX]] = [point(0), point(180)];
    const face =
      `<path d="${arc(1, 179)}" stroke="${LEARNING.ink}" stroke-opacity="0.16" stroke-width="${CARD.band}" fill="none" transform="translate(0 9)"/>` +
      microLabel(cue.label ?? "", 30, 54);
    const ends =
      glyph("LOW", lowX, CARD.cy + 54, end, LEARNING.ink, ' text-anchor="middle" letter-spacing="3.6"') +
      glyph("HIGH", highX, CARD.cy + 54, end, LEARNING.accentInk, ' text-anchor="middle" letter-spacing="3.6"');
    const zones = drawable(zone(1, 62, LEARNING.accent) + zone(62, 120, S.sand) + zone(120, 179, LEARNING.accentInk));
    const hub = `<circle cx="${CARD.cx}" cy="${CARD.cy}" r="30" fill="${LEARNING.accent}"/><circle cx="${CARD.cx}" cy="${CARD.cy}" r="11" fill="${LEARNING.ink}"/>`;
    const ghosts = [0.22, 0.12].map((opacity, index) => needle(`mg-ghost${index} pre`, opacity)).join("");
    const status = cue.tag ? tag(cue.tag, settleAt) : { html: "", motion: [] };
    const inner =
      unit("mg-face", face) +
      status.html +
      unit("mg-arc", zones) +
      unit("mg-ticks", ticks + ends) +
      ghosts +
      `<div class="u mg-shadow" style="filter:drop-shadow(0 6px 6px rgba(10,16,24,.35))">${needle("mg-needle", 1)}${unit("mg-hub", hub)}</div>`;
    const card = `<div class="box mg" style="left:${num(left)}px;top:${num(top)}px;width:${CARD.w}px;height:${CARD.h}px;border-radius:${CARD.radius}px;
background:linear-gradient(180deg,${S.card},${S.cardLow});box-shadow:${S.shadow},inset 0 2px 0 rgba(255,255,255,.9)">${inner}</div>`;
    const motion = [
      ...rise(".mg", 0, { distance: 30 }),
      drawOn(".mg-arc path", 0.15, { duration: 0.45, stagger: 0.12 }),
      fade(".mg-ticks", 0.2, { duration: 0.3 }),
      swing(".mg-needle", kickAt, settleAt, level),
      // Two faint needles trail the swing (a motion smear), gone once it settles.
      ...[0, 1].map((index) => swing(`.mg-ghost${index}`, kickAt, settleAt, level, 0.04 * (index + 1))),
      ...status.motion,
    ];
    return { html: card, motion, exit: fadeOut(".mg", duration) };
  },
};

module.exports = { meterGauge };
