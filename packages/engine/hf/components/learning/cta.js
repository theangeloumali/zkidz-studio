// Created by The Angelo Umali.
// commentCta: the closing ask (s_cta.png). The lead ("Comment") types in, a speech bubble's outline draws on below it and
// fills gold, the navy word rises into it letter by letter (clipped to the bubble), and an optional ink chip lands under it.
const { unit } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { spring, springLanding } = require("../../fx/springs");
const { LEARNING } = require("../../learning/tokens");
const { chip, chipBox } = require("./chips");
const { rectClip, glyph, fadeOut, reveal } = require("./typing");

const { cta: C, big: BIG, safe: SAFE } = LEARNING;

// A rounded rect with the tail dropping from its bottom edge, near the left (path drawn clockwise from the top-left).
function bubblePath({ left, top, w, h, size }) {
  const [right, bottom, r] = [left + w, top + h, C.radius * size];
  const [tailRight, tailLeft] = [left + (C.tailAt + C.tailWidth) * size, left + C.tailAt * size];
  const tip = [tailLeft - 0.06 * size, bottom + C.tailDrop * size];
  const arc = (x, y) => `A${num(r)} ${num(r)} 0 0 1 ${num(x)} ${num(y)}`;
  return (
    `M${num(left + r)} ${num(top)} H${num(right - r)} ${arc(right, top + r)} V${num(bottom - r)} ${arc(right - r, bottom)} ` +
    `H${num(tailRight)} L${num(tip[0])} ${num(tip[1])} L${num(tailLeft)} ${num(bottom)} H${num(left + r)} ${arc(left, bottom - r)} V${num(top + r)} ${arc(left + r, top)} Z`
  );
}

function ctaLayout(cue) {
  const lead = cue.lead ?? "Comment";
  const word = cue.word;
  const leadFont = { family: LEARNING.type.caption.family, weight: LEARNING.type.caption.weight, size: C.leadSize };
  const font = { ...LEARNING.type.display, size: cue.size ?? C.wordSize };
  const size = font.size;
  const w = advanceWidth(word, font) + 2 * C.padX * size;
  if (w > 1080 - 2 * SAFE.side) throw new Error(`commentCta "${word}" is ${Math.round(w)} px wide at size ${size}`);
  const h = (BIG.ascent + BIG.descent + 2 * C.padY) * size;
  const [x, leadY] = [cue.x ?? 540, cue.y ?? 600];
  const top = leadY + C.gap;
  const sub = cue.sub ? chipBox(cue.sub, C.subSize) : null;
  const subTop = top + h + C.tailDrop * size + C.subGap;
  if (sub && sub.width > 1080 - 2 * SAFE.side) throw new Error(`commentCta sub "${sub.label}" is ${sub.width} px wide`);
  const lowest = sub ? subTop + sub.height : top + h + C.tailDrop * size;
  if (leadY - C.leadSize < SAFE.top || lowest > SAFE.bottom) throw new Error(`commentCta "${word}" leaves the safe band ${SAFE.top}–${SAFE.bottom}`);
  const bubbleAt = cue.bubbleAt ?? lead.length * C.leadStep + 0.1;
  const wordAt = cue.wordAt ?? bubbleAt + C.draw + 0.15;
  const letters = [...word]
    .map((character, index) => ({ character, x: x - (w - 2 * C.padX * size) / 2 + advanceWidth(word.slice(0, index), font) }))
    .filter(({ character }) => character !== " ");
  const landing = wordAt + (letters.length - 1) * C.letterStep + springLanding("standard").duration;
  return { lead, word, leadFont, font, size, w, h, x, leadY, top, sub, subTop, bubbleAt, wordAt, subAt: cue.subAt ?? wordAt + 0.6, letters, landing };
}

const commentCta = {
  sfx: (cue) => {
    const { sub, subAt, landing } = ctaLayout(cue);
    return [{ at: 0, sound: "tick" }, { at: landing, sound: "hook" }, ...(sub ? [{ at: subAt, sound: "tick" }] : [])].sort((a, b) => a.at - b.at);
  },
  render(cue, { duration }) {
    const layout = ctaLayout(cue);
    const { lead, leadFont, font, size, w, h, x, leadY, top, bubbleAt, wordAt, letters } = layout;
    const leadLeft = x - advanceWidth(lead, leadFont) / 2;
    const leadEdges = Array.from({ length: lead.length + 1 }, (_, count) => leadLeft + advanceWidth(lead.slice(0, count), leadFont));
    const box = { left: x - w / 2, top, w, h, size };
    const d = bubblePath(box);
    const outline =
      `<path class="cta-outline" d="${d}" pathLength="1" stroke-dasharray="1 2" stroke-dashoffset="1" fill="none" ` +
      `stroke="${LEARNING.ink}" stroke-width="${C.stroke}" stroke-linejoin="round"/>`;
    const baseline = top + (C.padY + BIG.ascent) * size;
    const clip = rectClip(box.left, top, box.left + w, top + h);
    const word = letters.map(({ character, x: left }, index) =>
      unit(`cta-l${index}`, glyph(character, left, baseline, font, LEARNING.ink), [left + advanceWidth(character, font) / 2, baseline]),
    );
    const motion = [
      reveal(".cta-lead", 0, C.leadStep, leadEdges, [leadY - C.leadSize, leadY + 0.3 * C.leadSize]),
      {
        target: ".cta-outline",
        at: bubbleAt,
        from: { attr: { "stroke-dashoffset": 1 } },
        to: { attr: { "stroke-dashoffset": 0 }, duration: C.draw, ease: "power2.inOut" },
      },
      { target: ".cta-fill", at: bubbleAt + C.draw, from: { opacity: 0 }, to: { opacity: 1, duration: 0.12, ease: "power2.out" } },
      ...letters.flatMap((_, index) => {
        const at = wordAt + index * C.letterStep;
        return [
          { target: `.cta-l${index}`, at, from: { y: 0.55 * size }, to: { y: 0, ...spring("standard") } },
          { target: `.cta-l${index}`, at, from: { opacity: 0 }, to: { opacity: 1, duration: 0.08, ease: "power1.out" } },
        ];
      }),
    ];
    const subChip = layout.sub
      ? chip("cta-sub", { text: cue.sub, tone: "ink" }, [x - layout.sub.width / 2, layout.subTop], { size: C.subSize, at: layout.subAt })
      : null;
    if (subChip) motion.push(...subChip.motion);
    const inner =
      unit("cta-lead pre", glyph(lead, leadLeft, leadY, leadFont, LEARNING.ink)) +
      unit("cta-fill pre", `<path d="${d}" fill="${LEARNING.accent}"/>`) +
      unit("cta-bubble", outline) +
      `<div class="u cta-word" style="clip-path:${clip}">${word.join("")}</div>` +
      (subChip?.html ?? "");
    return { html: unit("cta", "", [x, top], inner), motion, exit: fadeOut(".cta", duration) };
  },
};

module.exports = { commentCta };
