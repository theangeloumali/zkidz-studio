// Created by The Angelo Umali.
// The learning-vlog chip: mono caps, tracked, on a small rounded plate ("ZOOM 120%", "RAW · UNGRADED"), popping in on its
// pin. chipRail lays a row of them; bigWord's kicker is one.
const { unit } = require("../../brand/html");
const { num, escapeXml } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { LEARNING } = require("../../learning/tokens");
const { fadeOut } = require("./typing");

const { chip: CHIP } = LEARNING;
const POP = { scale: 0.85, duration: 0.12 };
const TONES = {
  accent: { plate: LEARNING.accent, text: LEARNING.ink, opacity: 1 },
  ink: { plate: LEARNING.ink, text: LEARNING.paper, opacity: 1 },
  ghost: { plate: LEARNING.paper, text: LEARNING.ink, opacity: CHIP.ghostOpacity },
};

// Whole-pixel widths, so a row's gaps stay exactly CHIP.gap after rounding. A status `dot` takes one em before the text.
function chipBox(text, size = CHIP.size, dot = false) {
  const label = text.toUpperCase();
  const font = { family: LEARNING.type.mono.family, weight: CHIP.weight, size };
  const tracking = CHIP.tracking * size;
  const padX = CHIP.padX * size;
  const width = Math.ceil(advanceWidth(label, font) + tracking * (label.length - 1) + 2 * padX + (dot ? size : 0));
  return { label, font, tracking, padX, width, height: Math.round(CHIP.height * size) };
}

// One chip with its top-left at [x, top], drawn as unit `name`.
function chip(name, { text, tone = "accent", dot }, [x, top], { size, at }) {
  const colours = TONES[tone];
  if (!colours) throw new Error(`chip "${text}": tone is ${Object.keys(TONES).join(", ")}, not ${tone}`);
  const { label, font, tracking, padX, width, height } = chipBox(text, size, Boolean(dot));
  const baseline = top + height / 2 + (CHIP.capHeight * font.size) / 2;
  const [dotX, middle] = [x + padX + 0.25 * size, top + height / 2];
  const status = dot
    ? `<circle cx="${num(dotX)}" cy="${num(middle)}" r="${num(0.46 * size)}" fill="${dot}" fill-opacity="0.25"/><circle cx="${num(dotX)}" cy="${num(middle)}" r="${num(0.25 * size)}" fill="${dot}"/>`
    : "";
  const svg =
    `<rect class="chip-plate" x="${num(x)}" y="${num(top)}" width="${num(width)}" height="${num(height)}" rx="${num(CHIP.radius * font.size)}" ` +
    `fill="${colours.plate}"${colours.opacity < 1 ? ` fill-opacity="${colours.opacity}"` : ""}/>` +
    status +
    `<text x="${num(x + padX + (dot ? size : 0))}" y="${num(baseline)}" font-family="${escapeXml(font.family)}" font-weight="${font.weight}" font-size="${num(font.size)}" ` +
    `letter-spacing="${num(tracking)}" fill="${colours.text}" style="white-space:pre">${escapeXml(label)}</text>`;
  return {
    html: unit(name, svg, [x + width / 2, top + height / 2]),
    motion: [
      {
        target: `.${name.split(" ").at(-1)}`,
        at,
        from: { scale: POP.scale, opacity: 0 },
        to: { scale: 1, opacity: 1, duration: POP.duration, ease: "power2.out" },
      },
    ],
    width,
    height,
  };
}

const pinOf = (item, index) => Math.max(0, item.at ?? index * POP.duration);

function railLayout(cue) {
  const size = cue.size ?? CHIP.size;
  const boxes = cue.chips.map((item) => chipBox(item.text, size));
  const total = boxes.reduce((sum, box) => sum + box.width, CHIP.gap * (boxes.length - 1));
  const label = boxes.map((box) => box.label).join(" · ");
  if (total > 1080 - 2 * CHIP.side) throw new Error(`chipRail "${label}" is ${total} px wide at size ${size}`);
  const centred = cue.align === "center";
  let x = centred ? (cue.x ?? 540) - total / 2 : (cue.x ?? 80);
  const lefts = boxes.map((box) => {
    const left = x;
    x += box.width + CHIP.gap;
    return left;
  });
  return { size, lefts, top: cue.y ?? 300 };
}

const chipRail = {
  // One tick per moment: chips sharing a pin pop together.
  sfx: (cue) => [...new Set(cue.chips.map(pinOf))].map((at) => ({ at, sound: "tick" })),
  render(cue, { duration }) {
    const { size, lefts, top } = railLayout(cue);
    const chips = cue.chips.map((item, index) => chip(`chip chip${index}`, item, [lefts[index], top], { size, at: pinOf(item, index) }));
    return {
      html: unit("rail", "", [0, 0], chips.map((part) => part.html).join("")),
      motion: chips.flatMap((part) => part.motion),
      exit: fadeOut(".rail", duration),
    };
  },
};

module.exports = { chipRail, chip, chipBox };
