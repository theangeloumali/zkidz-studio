// Created by The Angelo Umali.
// stepBars: bars rising from one baseline on their pins, a label under each, and an optional gold arrow drawing up to the
// last. For a rise he says in words ("a better future than the one I got"): heights are shares of maxHeight, never figures.
const { unit } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { LEARNING } = require("../../learning/tokens");
const { glyph, fadeOut } = require("./typing");
const { penReveal } = require("../../fx/ink");
const { column, assertTone } = require("./objects");
const { onCover } = require("../../learning/cover");

const { bars: B } = LEARNING;

function layout(cue) {
  const width = cue.barWidth ?? B.width;
  const total = cue.bars.length * width + (cue.bars.length - 1) * B.gap;
  const names = cue.bars.map((bar) => bar.label).join(" · ");
  if (total > 1080 - 2 * LEARNING.big.side) throw new Error(`stepBars "${names}" is ${total} px wide`);
  const [baseline, max] = [cue.y ?? B.baseline, cue.maxHeight ?? B.maxHeight];
  const left = (cue.x ?? 540) - total / 2;
  return cue.bars.map((bar, index) => {
    if (!(bar.height > 0 && bar.height <= 1)) throw new Error(`stepBars bar "${bar.label}": height is a share in (0, 1], not ${bar.height}`);
    const tone = bar.tone ?? (index === cue.bars.length - 1 ? "accent" : "ink");
    assertTone(tone, `stepBars bar "${bar.label}"`);
    const x = left + index * (width + B.gap);
    return {
      ...bar,
      x,
      width,
      height: bar.height * max,
      baseline,
      tone,
      at: Math.max(0, bar.at ?? index * 0.3),
    };
  });
}

// The arrow from above the first bar to above the last, revealed left to right once the last bar has grown.
function arrow(bars, at) {
  const [first, last] = [bars[0], bars.at(-1)];
  const [x1, y1] = [first.x + first.width / 2, first.baseline - first.height - B.arrowGap];
  const [x2, y2] = [last.x + last.width / 2, last.baseline - last.height - B.arrowGap];
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = (turn) => `${num(x2 - 34 * Math.cos(angle + turn))},${num(y2 - 34 * Math.sin(angle + turn))}`;
  const svg =
    `<path d="M${num(x1)} ${num(y1)} L${num(x2)} ${num(y2)}" stroke="${LEARNING.rule}" stroke-width="${B.arrowWidth}" stroke-linecap="round" fill="none"/>` +
    `<polygon points="${num(x2)},${num(y2)} ${head(0.45)} ${head(-0.45)}" fill="${LEARNING.rule}"/>`;
  const [top, bottom] = [Math.min(y1, y2) - 40, Math.max(y1, y2) + 40];
  return {
    html: unit("arrow", svg),
    motion: [penReveal(".arrow", [at, at + 0.35], [x1 - 20, top, x2 + 40, bottom], { ease: "power2.inOut" })],
  };
}

// The arrow needs two bars to point between; it draws once the last has grown.
const arrowAt = (cue, bars) => (cue.arrow && bars.length > 1 ? bars.at(-1).at + B.grow : null);

const stepBars = {
  sfx(cue) {
    const bars = layout(cue);
    const at = arrowAt(cue, bars);
    return [...bars.map((bar) => ({ at: bar.at, sound: "tick" })), ...(at === null ? [] : [{ at, sound: "rule" }])];
  },
  render(cue, { duration, cues }) {
    const bars = layout(cue);
    const font = { ...LEARNING.type.caption, size: B.labelSize };
    const ink = onCover(cue, cues) ? LEARNING.ink : LEARNING.white; // navy labels vanish over footage
    const parts = bars.map((bar, index) => {
      const label = bar.label.toUpperCase();
      const centre = bar.x + bar.width / 2;
      // A dimensional level on a soft floor shadow (storyboard 08): its lit top and shaded side grow with it.
      const floor = `<ellipse cx="${num(centre + bar.width * 0.16)}" cy="${num(bar.baseline + 6)}" rx="${num(bar.width * 0.75)}" ry="18" fill="${LEARNING.ink}" fill-opacity="0.1"/>`;
      const rect = floor + column(bar.x, bar.baseline, bar.width, bar.height, bar.tone, ' class="bar"');
      return {
        html:
          unit(`bar bar${index}`, rect, [centre, bar.baseline]) +
          unit(`blabel blabel${index}`, glyph(label, centre - advanceWidth(label, font) / 2, bar.baseline + B.labelGap, font, ink), [centre, bar.baseline]),
        motion: [
          { target: `.bar${index}`, at: bar.at, from: { scaleY: 0 }, to: { scaleY: 1, duration: B.grow, ease: "power3.out" } },
          { target: `.blabel${index}`, at: bar.at, from: { opacity: 0, y: 14 }, to: { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" } },
        ],
      };
    });
    const at = arrowAt(cue, bars);
    const pointer = at === null ? { html: "", motion: [] } : arrow(bars, at);
    return {
      html: unit("bars", "", [0, 0], parts.map((part) => part.html).join("") + pointer.html),
      motion: [...parts.flatMap((part) => part.motion), ...pointer.motion],
      exit: fadeOut(".bars", duration),
    };
  },
};

module.exports = { stepBars };
