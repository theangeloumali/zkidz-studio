// Created by The Angelo Umali.
// bigWord: huge Chakra Petch Bold words and figures on footage (in clear space, never behind him) or paper, with one motion: letters
// drop or tumble in, a figure rolls like an odometer (count, steps), a slot rolls between words (slot, words-live.js), else
// it rises out of a blur. Optional kicker, strike and scribble; never a plate (the v2 rules ban backdrops behind words).
const { unit } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { canvasBrand } = require("../../brand/canvas");
const { rise, exit } = require("../../fx/motion");
const { spring, springLanding } = require("../../fx/springs");
const { LEARNING } = require("../../learning/tokens");
const { onCover } = require("../../learning/cover");
const { chip, chipBox } = require("./chips");
const { glyph } = require("./typing");
const { penReveal } = require("../../fx/ink");
const { odometerColumns, odometerStrip } = require("./odometer");
const { slotBody, scribble } = require("./words-live");

const { big: BIG } = LEARNING;
const MOTIONS = ["drop", "tumble", "count", "steps", "slot"];
const LETTERS = { drop: 0.05, tumble: 0.06, start: 0.1 };
const ROLL = { count: 0.9, step: 0.35, blur: 7, clip: 0.08 };
const { mulberry32 } = canvasBrand().scope;

function motionOf(cue) {
  const chosen = MOTIONS.filter((name) => cue[name] !== undefined && cue[name] !== false);
  if (chosen.length > 1) throw new Error(`bigWord "${cue.text ?? ""}" has ${chosen.join(" and ")}: one motion at a time`);
  return chosen[0] ?? "rise";
}

// The figure's values in order and when each roll starts: a count is one roll, steps roll on their pins in time order.
function rollsOf(cue, motion, duration) {
  const decimals = cue.count?.decimals ?? 0;
  const scaled = (value) => Math.round(value * 10 ** decimals);
  if (motion === "count") return { decimals, values: [cue.count.from, cue.count.to].map(scaled), pins: [cue.countAt ?? 0.3], seconds: ROLL.count };
  const steps = cue.steps
    .map((step) => ({ ...step, at: Math.max(0, step.at) }))
    .filter((step) => step.at < duration)
    .sort((first, second) => first.at - second.at);
  return { decimals, values: [cue.from ?? 0, ...steps.map((step) => step.to)].map(scaled), pins: steps.map((step) => step.at), seconds: ROLL.step };
}

function refuseWide(label, width, size) {
  if (width > 1080 - 2 * BIG.side) throw new Error(`bigWord "${label}" is ${Math.round(width)} px wide at size ${size}`);
}

// Static prefix, point and suffix around one clipped strip per column, its first value on the baseline; a roll moves it
// by whole rows. Refused by width before any strip is built.
function figure(cue, layout, motion, duration) {
  const { font, colour, x, baseline } = layout;
  const rolls = rollsOf(cue, motion, duration);
  const pad = cue.count?.pad ?? cue.pad ?? 1;
  const [prefix, suffix] = [cue.count?.prefix ?? cue.prefix ?? "", cue.count?.suffix ?? cue.suffix ?? ""];
  // The width check runs before odometerColumns builds any strip, so `places` is worked out here first.
  const places = Math.max(String(Math.max(...rolls.values)).length, rolls.decimals + pad);
  const cell = advanceWidth("0", font);
  const point = rolls.decimals ? advanceWidth(".", font) : 0;
  const total = advanceWidth(prefix, font) + cell * places + point + advanceWidth(suffix, font);
  const last = (rolls.values.at(-1) / 10 ** rolls.decimals).toFixed(rolls.decimals);
  refuseWide(`${prefix}${last}${suffix}`, total, font.size);
  const columns = odometerColumns(rolls.values, { decimals: rolls.decimals, pad });
  const line = BIG.rollLine * font.size;
  const filter = `s${cue.seed}-roll`;
  let left = x - total / 2;
  let svg = `<defs><filter id="${filter}" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur class="roll-blur" stdDeviation="0 0"/></filter></defs>`;
  const fixed = (text) => {
    if (text) svg += glyph(text, left, baseline, font, colour);
    left += advanceWidth(text, font);
  };
  fixed(prefix);
  const top = baseline - (BIG.ascent + ROLL.clip) * font.size;
  const height = (BIG.ascent + BIG.descent + 2 * ROLL.clip) * font.size;
  columns.forEach(({ digits, rows }, index) => {
    if (rolls.decimals && index === places - rolls.decimals) fixed(".");
    svg += odometerStrip(`s${cue.seed}-col${index}`, { digits, rows }, [left, top, cell, height], {
      baseline,
      line,
      font,
      colour,
      group: `class="roll" data-col="${index}" filter="url(#${filter})"`,
    });
    left += cell;
  });
  fixed(suffix);
  const seconds = (at) => Math.min(rolls.seconds, Math.max(duration - at, 1e-3));
  const offset = (rows, step) => -(rows[step] - rows[0]) * line;
  const motionSpecs = rolls.pins.flatMap((at, step) => {
    const timing = { duration: seconds(at), ease: "power3.out", immediateRender: false };
    const moved = columns.flatMap(({ rows }, index) =>
      rows[step + 1] === rows[step]
        ? []
        : [{ target: `.roll[data-col="${index}"]`, at, from: { y: offset(rows, step) }, to: { y: offset(rows, step + 1), ...timing } }],
    );
    const blur = { target: ".roll-blur", at, from: { attr: { stdDeviation: `0 ${ROLL.blur}` } }, to: { attr: { stdDeviation: "0 0" }, ...timing } };
    return moved.length ? [...moved, blur] : [];
  });
  const landing = motion === "count" && motionSpecs.length ? rolls.pins[0] + seconds(rolls.pins[0]) : null;
  return { svg, html: "", motion: motionSpecs, landing, ticks: motion === "steps" ? rolls.pins : [], width: total };
}

// Letters as their own units, so each can fall or tumble in about its own centre.
function letters(cue, layout, motion) {
  const { font, colour, x, baseline } = layout;
  const width = advanceWidth(cue.text, font);
  refuseWide(cue.text, width, font.size);
  const left = x - width / 2;
  if (motion === "rise") return { svg: glyph(cue.text, left, baseline, font, colour), html: "", motion: [], landing: null, width };
  const rand = mulberry32(cue.seed * 31 + 7);
  const placed = [...cue.text]
    .map((character, index) => ({ character, x: left + advanceWidth(cue.text.slice(0, index), font) }))
    .filter(({ character }) => character !== " ");
  let html = "";
  const specs = placed.flatMap(({ character, x: letterX }, index) => {
    const name = `l${index}`;
    const centre = [letterX + advanceWidth(character, font) / 2, baseline - (BIG.ascent * font.size) / 2];
    html += unit(`l ${name}`, glyph(character, letterX, baseline, font, colour), centre);
    const at = LETTERS.start + index * LETTERS[motion];
    const from =
      motion === "drop"
        ? { y: -1.1 * font.size }
        : { x: (rand() - 0.5) * 0.8 * font.size, y: 0.5 * font.size, rotation: (rand() < 0.5 ? -1 : 1) * (120 + rand() * 160), scale: 0.6 };
    const rest = Object.fromEntries(Object.keys(from).map((key) => [key, key === "scale" ? 1 : 0]));
    return [
      { target: `.${name}`, at, from, to: { ...rest, ...spring("standard") } },
      { target: `.${name}`, at, from: { opacity: 0 }, to: { opacity: 1, duration: 0.08, ease: "power1.out" } },
    ];
  });
  const last = LETTERS.start + (placed.length - 1) * LETTERS[motion];
  return { svg: "", html, motion: specs, landing: motion === "drop" ? last + springLanding("standard").duration : null, width };
}

function layoutOf(cue, cues) {
  const font = { ...LEARNING.type.display, size: cue.size ?? 240 };
  const ground = onCover(cue, cues) ? LEARNING.ink : LEARNING.white;
  return { font, colour: cue.color ?? ground, x: cue.x ?? 540, baseline: cue.y ?? 560 };
}

function bigWordParts(cue, { cues, duration }) {
  const [motion, layout] = [motionOf(cue), layoutOf(cue, cues)];
  if (motion === "slot") return { motion, layout, body: slotBody(cue, layout, refuseWide) };
  return { motion, layout, body: motion === "count" || motion === "steps" ? figure(cue, layout, motion, duration) : letters(cue, layout, motion) };
}

// The kicker chip centred above the word.
function extras(cue, { font, x, baseline }) {
  const box = cue.kicker && chipBox(cue.kicker, BIG.kickerSize);
  const top = baseline - BIG.ascent * font.size;
  return box
    ? chip("kicker", { text: cue.kicker }, [x - box.width / 2, top - BIG.kickerGap - box.height], { size: BIG.kickerSize, at: 0 })
    : { html: "", motion: [] };
}

// An accent bar drawn left to right through the word on `strikeAt` ("no more toys").
function strike(cue, { font, x, baseline }, width) {
  if (cue.strikeAt === undefined) return { html: "", motion: [] };
  const [left, right, top, height] = [x - width / 2 - 0.06 * font.size, x + width / 2 + 0.06 * font.size, baseline - 0.4 * font.size, 0.09 * font.size];
  return {
    html: unit(
      "strike",
      `<rect x="${num(left)}" y="${num(top)}" width="${num(right - left)}" height="${num(height)}" rx="${num(height / 2)}" fill="${LEARNING.accent}"/>`,
    ),
    motion: [penReveal(".strike", [cue.strikeAt, cue.strikeAt + 0.25], [left, top - 4, right, top + height + 4], { ease: "power2.out" })],
  };
}

const bigWord = {
  sfx: (cue, duration) => {
    const { landing, ticks = [] } = bigWordParts(cue, { cues: [cue], duration }).body;
    const riser = landing === null ? [] : [{ at: landing, sound: "riser" }];
    const struck = cue.strikeAt === undefined ? [] : [{ at: cue.strikeAt, sound: "rule" }];
    const scrawl = cue.scribbleAt === undefined ? [] : [{ at: cue.scribbleAt, sound: "scratch", dur: 0.5 }];
    return [...riser, ...ticks.map((at) => ({ at, sound: "tick" })), ...(cue.hit ? [{ at: landing ?? 0, sound: "hook" }] : []), ...struck, ...scrawl];
  },
  render(cue, { cues, duration }) {
    const { motion, layout, body } = bigWordParts(cue, { cues, duration });
    const around = extras(cue, layout);
    const line = strike(cue, layout, body.width);
    const scrawl = scribble(cue, layout, body.width);
    const entrance = motion === "drop" || motion === "tumble" ? [] : rise(".word", 0, { distance: 30, scaleFrom: 0.98, blur: 10 });
    return {
      html: unit("word", "", [layout.x, layout.baseline], around.html + unit("glyphs", body.svg) + body.html + line.html + scrawl.html),
      motion: [...entrance, ...around.motion, ...body.motion, ...line.motion, ...scrawl.motion],
      exit: exit(".word", duration),
    };
  },
};

module.exports = { bigWord };
