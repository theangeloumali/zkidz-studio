// Created by The Angelo Umali.
// The learning vlog's UI mocks: typedPrompt, the near-black terminal card a prompt types into while agent output scrolls
// past blurred (s_info.png), and askField, the chat field whose message flies up into a sent bubble (s_chat.png).
const { unit } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { rise, show, hide } = require("../../fx/motion");
const { spring } = require("../../fx/springs");
const { LEARNING } = require("../../learning/tokens");
const { rectClip, glyph, microLabel, fadeOut, track, reveal, blink, typingStep, wrapColumns } = require("./typing");

const { prompt: T, field: F, safe: SAFE, micro: MICRO } = LEARNING;
const MONO = LEARNING.type.mono;

function promptLayout(cue, duration) {
  const font = { ...MONO, size: T.size };
  const cell = advanceWidth("M", font);
  const [x, y, w] = [cue.x ?? 150, cue.y ?? 870, cue.w ?? 780];
  const lineHeight = T.line * T.size;
  const left = x + T.padX + 2 * cell;
  const lines = wrapColumns(cue.text ?? "", Math.floor((x + w - T.padX - left) / cell) - 1);
  const rows = Math.max(T.rows, lines.length);
  const h = T.header + rows * lineHeight + T.padBottom;
  if (y < SAFE.top || y + h > SAFE.bottom)
    throw new Error(`typedPrompt "${cue.text}": its card (${y}–${num(y + h)}) leaves the safe band ${SAFE.top}–${SAFE.bottom}`);
  const end = duration - LEARNING.exit;
  const typeAt = cue.typeAt ?? 0.3;
  const count = lines.join("").length;
  const step = typingStep("typedPrompt", cue.text, count, typeAt, end, "its exit at", cue.cps ?? T.cps);
  const typed = typeAt + count * step;
  const outputAt = cue.outputAt ?? typed + T.outputGap;
  const output = (cue.output ?? [])
    .map((text, index) => ({ text, at: outputAt + index * T.outputStep, row: lines.length + index }))
    .filter((line) => line.at < end);
  const baseline = (row) => y + T.header + row * lineHeight + (lineHeight + 0.73 * T.size) / 2;
  return { font, cell, x, y, w, h, left, lines, rows, lineHeight, baseline, typeAt, step, count, typed, output, outputAt };
}

// The content scrolls a line up, in a short glide, whenever an output line arrives below the last visible row.
function scrollTrack(layout) {
  const { output, rows, lineHeight } = layout;
  const glide = Math.min(0.1, T.outputStep * 0.8);
  let [last, y] = [0, 0];
  const frames = output
    .filter((line) => line.row >= rows)
    .flatMap((line) => {
      const hold = { y, duration: line.at - last, ease: "none" };
      [last, y] = [line.at + glide, -(line.row - rows + 1) * lineHeight];
      return [hold, { y, duration: glide, ease: "power2.out" }];
    });
  return frames.length ? [{ target: ".tp-scroll", at: 0, to: { keyframes: [{ y: 0, duration: 0 }, ...frames] } }] : [];
}

const typedPrompt = {
  sfx: (cue, duration) => {
    const { count, typeAt, step } = promptLayout(cue, duration);
    return count ? [{ at: typeAt, sound: "type", dur: count * step }] : [];
  },
  render(cue, { duration }) {
    const layout = promptLayout(cue, duration);
    const { font, cell, x, y, w, h, left, lines, baseline, typeAt, step, typed, output, outputAt, lineHeight } = layout;
    const blur = `s${cue.seed}-tp-blur`;
    const ink = (opacity) => ` fill-opacity="${opacity}"`;
    const card =
      `<defs><filter id="${blur}" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="${T.outputBlur}"/></filter></defs>` +
      `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${T.radius}" fill="${LEARNING.terminal}"/>` +
      `<circle cx="${num(x + T.padX + T.dot)}" cy="${num(y + T.header / 2)}" r="${T.dot}" fill="${LEARNING.accent}"/>` +
      glyph(cue.title ?? "terminal", x + T.padX + 3 * T.dot + 8, y + T.header / 2 + 0.36 * 22, { ...font, size: 22 }, T.text, ink(T.titleOpacity));
    const motion = [...rise(".tp", 0, { distance: 24 })];
    // Each line types on its own window; the block cursor (outer unit moves, inner blinks) follows each letter.
    let before = 0;
    const moves = [];
    const typedLines = lines.map((line, row) => {
      const at = typeAt + before * step;
      before += line.length;
      const xs = Array.from({ length: line.length + 1 }, (_, count) => left + count * cell);
      moves.push(...xs.slice(1).map((_, index) => [at + (index + 1) * step, { x: (index + 1) * cell, y: row * lineHeight }]));
      if (line) motion.push(reveal(`.tp-line${row}`, at, step, xs, [baseline(row) - 1.1 * T.size, baseline(row) + 0.4 * T.size]));
      return line ? unit(`tp-line${row} pre`, glyph(line, left, baseline(row), font, T.text)) : "";
    });
    const outputs = output.map((line, index) => {
      const arrive = { opacity: T.outputOpacity, y: 0, duration: 0.18, ease: "power2.out" };
      motion.push({ target: `.tp-out${index}`, at: line.at, from: { opacity: 0, y: 12 }, to: arrive });
      return unit(`tp-out${index} pre`, glyph(line.text, x + T.padX, baseline(line.row), font, T.text, ` filter="url(#${blur})"`));
    });
    if (moves.length) motion.push(track(".tp-cursor-at", 0, { x: 0, y: 0 }, moves));
    motion.push(blink(".tp-cursor", [typeAt, typed], output.length ? outputAt : duration), ...scrollTrack(layout));
    const block = `<rect x="${num(left)}" y="${num(baseline(0) - 0.78 * T.size)}" width="${num(cell)}" height="${num(0.98 * T.size)}" fill="${T.text}"/>`;
    const cursor = unit("tp-cursor-at", "", [0, 0], unit("tp-cursor", block));
    const prompt = unit("tp-prompt", glyph(">", x + T.padX, baseline(0), font, T.text, ink(0.6)));
    const clip = rectClip(x, y + T.header - 8, x + w, y + h - 8);
    const content = `<div class="u tp-window" style="clip-path:${clip}">${unit("tp-scroll", "", [0, 0], prompt + typedLines.join("") + outputs.join("") + cursor)}</div>`;
    return { html: unit("tp", card, [x + w / 2, y + h / 2], content), motion, exit: fadeOut(".tp", duration) };
  },
};

function fieldLayout(cue, duration) {
  const font = { ...LEARNING.type.ui, size: F.size };
  const [x, top, w] = [cue.x ?? 140, cue.y ?? 760, cue.w ?? 800];
  const text = cue.text ?? "";
  const [left, sendX] = [x + F.padX, x + w - 18 - F.send];
  const room = sendX - F.send - 16 - left;
  const width = advanceWidth(text, font);
  if (width > room) throw new Error(`askField "${text}" is ${Math.round(width)} px wide; the field holds ${Math.round(room)}`);
  const middle = top + F.height / 2;
  const labelY = top - F.labelGap;
  const status = (cue.status ?? []).map((item) => ({ ...item, label: item.text.toUpperCase() })).sort((a, b) => a.at - b.at);
  const sendAt = cue.sendAt;
  const late = sendAt === undefined ? [] : status.filter((item) => item.at < sendAt);
  if (late.length) throw new Error(`askField status "${late[0].label}" at ${late[0].at} is before sendAt ${sendAt}`);
  const bottom = top + F.height + F.statusGap;
  if ((cue.label ? labelY - MICRO.size : top) < SAFE.top || bottom > SAFE.bottom)
    throw new Error(`askField "${text}" leaves the safe band ${SAFE.top}–${SAFE.bottom}`);
  const typeAt = cue.typeAt ?? 0.3;
  const end = sendAt ?? duration - LEARNING.exit;
  const step = typingStep("askField", text, text.length, typeAt, end, sendAt === undefined ? "its exit at" : "sendAt", cue.cps ?? T.cps);
  return { font, x, top, w, text, left, sendX, middle, labelY, status, sendAt, typeAt, step, baseline: middle + 0.36 * F.size };
}

// Text typed into a field from `at`, a letter every `step`, its window [top, bottom] (askField, chatThread). `xs` are its
// right edges after each letter.
function typedText(name, text, font, [left, baseline], [top, bottom], at, step) {
  const xs = Array.from({ length: text.length + 1 }, (_, count) => left + advanceWidth(text.slice(0, count), font));
  return { html: unit(`${name} pre`, glyph(text, left, baseline, font, LEARNING.ink)), motion: [reveal(`.${name}`, at, step, xs, [top, bottom])], xs };
}

// A sent message flying up out of the field into its bubble from `rise` px below and 94 % (askField, chatThread).
const flyUp = (target, at, rise) => [
  { target, at, from: { y: rise, scale: 0.94 }, to: { y: 0, scale: 1, ...spring("snappy") } },
  { target, at, from: { opacity: 0 }, to: { opacity: 1, duration: 0.12, ease: "power2.out" } },
];

// The sent bubble, ink with white Inter, right-aligned over the label (or the field); it flies up from the field's text.
function sentBubble(cue, layout) {
  const font = { ...LEARNING.type.ui, size: F.bubbleSize };
  const width = advanceWidth(layout.text, font) + 2 * F.bubblePadX;
  const bottom = (cue.label ? layout.labelY - MICRO.size : layout.top) - F.bubbleGap;
  const [right, top] = [layout.x + layout.w, bottom - F.bubbleHeight];
  const baseline = top + F.bubbleHeight / 2 + 0.36 * F.bubbleSize;
  const svg =
    `<rect x="${num(right - width)}" y="${num(top)}" width="${num(width)}" height="${F.bubbleHeight}" rx="${F.bubbleRadius}" fill="${LEARNING.ink}"/>` +
    glyph(layout.text, right - width + F.bubblePadX, baseline, font, LEARNING.white);
  const at = layout.sendAt;
  return {
    html: unit("af-bubble pre", svg, [right, bottom]),
    motion: flyUp(".af-bubble", at, layout.baseline - baseline),
  };
}

function statusLines(layout) {
  const font = { ...MONO, size: F.statusSize };
  const y = layout.top + F.height + F.statusGap;
  const html = layout.status.map((item, index) => {
    const check = item.ok
      ? `<path class="af-check" d="M${layout.x + 4} ${y - 8} l6 6 l12 -14" fill="none" stroke="${LEARNING.accentInk}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
      : "";
    const text = glyph(item.label, layout.x + (item.ok ? 30 : 4), y, font, LEARNING.ink, ` fill-opacity="${MICRO.opacity}" letter-spacing="2"`);
    return unit(`af-status${index} pre`, check + text);
  });
  const motion = layout.status.flatMap((item, index) => [
    { target: `.af-status${index}`, at: item.at, from: { opacity: 0 }, to: { opacity: 1, duration: 0.15, ease: "power2.out" } },
    ...(layout.status[index + 1] ? [hide(`.af-status${index}`, layout.status[index + 1].at)] : []),
  ]);
  return { html: html.join(""), motion };
}

const askField = {
  sfx: (cue, duration) => {
    const { text, typeAt, step, sendAt, status } = fieldLayout(cue, duration);
    return [
      ...(text ? [{ at: typeAt, sound: "type", dur: text.length * step }] : []),
      ...(sendAt === undefined ? [] : [{ at: sendAt, sound: "swish" }]),
      ...status.filter((item) => item.ok).map((item) => ({ at: item.at, sound: "check" })),
    ].sort((a, b) => a.at - b.at);
  },
  render(cue, { duration }) {
    const layout = fieldLayout(cue, duration);
    const { font, x, top, w, text, left, sendX, middle, typeAt, step, sendAt, baseline } = layout;
    const typedEnd = typeAt + text.length * step;
    const typed = typedText("af-text", text, font, [left, baseline], [top, top + F.height], typeAt, step);
    const field =
      (cue.label ? microLabel(cue.label, x, layout.labelY) : "") +
      `<rect x="${x}" y="${top}" width="${w}" height="${F.height}" rx="${F.radius}" fill="${LEARNING.white}" stroke="${LEARNING.ink}" stroke-opacity="${F.stroke}" stroke-width="2"/>` +
      `<circle cx="${num(sendX)}" cy="${num(middle)}" r="${F.send}" fill="${LEARNING.ink}" fill-opacity="${F.idle}"/>`;
    const arrow = `<path d="M${num(sendX)} ${num(middle + 9)} v-18 m-7 7 l7 -7 l7 7" fill="none" stroke="${LEARNING.white}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    const placeholder = glyph(cue.placeholder ?? "Ask for any change…", left, baseline, font, LEARNING.ink, ` fill-opacity="${F.placeholderOpacity}"`);
    const caret = `<rect x="${num(left)}" y="${num(baseline - 0.8 * F.size)}" width="3" height="${num(1.05 * F.size)}" fill="${LEARNING.ink}"/>`;
    const motion = [...rise(".af", 0, { distance: 20 })];
    const moves = typed.xs.slice(1).map((edge, index) => [typeAt + (index + 1) * step, { x: edge - left }]);
    if (sendAt !== undefined) moves.push([sendAt, { x: 0 }]);
    if (moves.length) motion.push(track(".af-cursor-at", 0, { x: 0 }, moves));
    motion.push(blink(".af-cursor", [typeAt, typedEnd], duration));
    let pieces = unit("af-placeholder", placeholder) + unit("af-cursor-at", "", [0, 0], unit("af-cursor", caret));
    if (text) {
      pieces += typed.html + unit("af-send-on pre", `<circle cx="${num(sendX)}" cy="${num(middle)}" r="${F.send}" fill="${LEARNING.accent}"/>`);
      motion.push(hide(".af-placeholder", typeAt), ...typed.motion, show(".af-send-on", typeAt + step));
      if (sendAt !== undefined) motion.push(hide(".af-text", sendAt));
    }
    const bubble = text && sendAt !== undefined ? sentBubble(cue, layout) : { html: "", motion: [] };
    const statuses = statusLines(layout);
    motion.push(...bubble.motion, ...statuses.motion);
    const html = unit("af", field, [x + w / 2, top + F.height / 2], pieces + unit("af-arrow", arrow) + bubble.html + statuses.html);
    return { html, motion, exit: fadeOut(".af", duration) };
  },
};

module.exports = { typedPrompt, askField, typedText, flyUp };
