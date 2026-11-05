// Created by The Angelo Umali.
// chatThread (storyboard 11): a chat card. The first "me" message types into the field, then sends up into a navy bubble;
// an assistant reply streams in word by word behind an orange caret. Only words he says or did appear (never invented).
const { unit } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { rise, hide, fade } = require("../../fx/motion");
const { spring } = require("../../fx/springs");
const { LEARNING } = require("../../learning/tokens");
const { glyph, fadeOut, track, reveal, typingStep } = require("./typing");
const { typedText, flyUp } = require("./ui");

const { shade: S } = LEARNING;
const C = { w: 616, minH: 548, header: 88, pad: 28, gap: 22, padX: 26, padY: 20, size: 32, line: 1.3, maxText: 448, field: 88, fieldGap: 24 };
const WORD_STEP = 0.09;
const FROM = { me: { weight: 600, fill: LEARNING.ink, text: LEARNING.paper }, assistant: { weight: 500, fill: S.bubble, text: LEARNING.ink } };

function wrap(text, font) {
  const lines = [[]];
  for (const word of text.split(" ")) {
    const next = [...lines.at(-1), word].join(" ");
    if (lines.at(-1).length && advanceWidth(next, font) > C.maxText) lines.push([word]);
    else lines.at(-1).push(word);
  }
  return lines;
}

function layout(cue, duration) {
  const w = cue.w ?? C.w;
  let top = C.header + 26;
  const messages = (cue.messages ?? []).map((message, index) => {
    const style = FROM[message.from];
    if (!style) throw new Error(`chatThread message "${message.text}": from is me or assistant, not ${message.from}`);
    const font = { ...LEARNING.type.ui, weight: style.weight, size: C.size };
    const lines = wrap(message.text, font);
    const step = C.size * C.line;
    const width = Math.max(...lines.map((words) => advanceWidth(words.join(" "), font))) + 2 * C.padX;
    const height = lines.length * step + 2 * C.padY;
    const left = message.from === "me" ? w - C.pad - width : C.pad;
    const placed = { ...message, index, style, font, lines, step, width, height, left, top };
    top += height + C.gap;
    return placed;
  });
  const h = Math.max(C.minH, top + C.fieldGap + C.field);
  const field = { top: h - C.fieldGap - C.field, font: { ...LEARNING.type.ui, weight: 500, size: 30 } };
  field.baseline = field.top + C.field / 2 + 0.36 * field.font.size;
  const first = messages.find((message) => message.from === "me");
  if (first) {
    const room = w - 2 * C.fieldGap - 30 - 90;
    if (advanceWidth(first.text, field.font) > room) throw new Error(`chatThread "${first.text}" is too wide to type into the field`);
    first.typeStep = typingStep("chatThread", first.text, first.text.length, first.at, duration - LEARNING.exit, "its exit at", LEARNING.prompt.cps);
    first.sendAt = first.sendAt ?? first.at + first.text.length * first.typeStep + 0.25;
  }
  return { w, h, x: cue.x ?? 64, y: cue.y ?? 360, messages, field, first };
}

// A reply streamed word by word: one text per line whose clip opens to each word's end on that word's beat, and a caret
// riding after the newest word.
function stream(message, base) {
  const html = [];
  const motion = [];
  const caret = [];
  let index = 0;
  message.lines.forEach((words, row) => {
    const left = message.left + C.padX;
    const y = message.top + C.padY + row * message.step + 0.78 * C.size;
    const ends = words.map((_, count) => left + advanceWidth(words.slice(0, count + 1).join(" "), message.font));
    const first = message.at + index * WORD_STEP;
    html.push(unit(`ct-line${message.index}-${row} pre`, glyph(words.join(" "), left, y, message.font, message.style.text)));
    // reveal() opens one step after its start, so the line starts a step early to show its first word on its beat.
    motion.push(reveal(`.ct-line${message.index}-${row}`, first - WORD_STEP, WORD_STEP, [left, ...ends], [y - C.size, y + 0.4 * C.size]));
    ends.forEach((end) => {
      caret.push([message.at + index * WORD_STEP, { x: end + 4 - base.x, y: y - base.y }]);
      index += 1;
    });
  });
  const [, first] = caret.shift();
  caret.push([message.at + index * WORD_STEP + 0.8, { opacity: 0 }]);
  motion.push(track(`.ct-caret${message.index}`, message.at, { opacity: 1, ...first }, caret));
  const bar = `<rect x="${num(base.x)}" y="${num(base.y - 0.8 * C.size)}" width="4" height="${num(1.05 * C.size)}" fill="${LEARNING.accentInk}"/>`;
  return { html: html.join("") + unit(`ct-caret${message.index} pre`, bar), motion };
}

// The typed question types then sends; a reply types as it streams; a later message of his only sends.
function soundsOf(message, first) {
  if (message === first)
    return [
      { at: message.at, sound: "type", dur: message.text.length * message.typeStep },
      { at: message.sendAt, sound: "swish" },
    ];
  if (message.from === "assistant") return [{ at: message.at, sound: "type", dur: message.text.split(" ").length * WORD_STEP }];
  return [{ at: message.at, sound: "swish" }];
}

function bubble(message) {
  const { left, top, width, height, style } = message;
  return `<rect x="${num(left)}" y="${num(top)}" width="${num(width)}" height="${num(height)}" rx="26" fill="${style.fill}"/>`;
}

const chatThread = {
  sfx(cue, duration) {
    const { messages, first } = layout(cue, duration);
    return messages.flatMap((message) => soundsOf(message, first)).sort((a, b) => a.at - b.at);
  },
  render(cue, { duration }) {
    const { w, h, x, y, messages, field, first } = layout(cue, duration);
    const ui = (size, weight) => ({ ...LEARNING.type.ui, size, weight });
    const head =
      `<circle cx="48" cy="44" r="20" fill="${LEARNING.ink}"/><circle cx="42" cy="38" r="8" fill="#FFFFFF" fill-opacity="0.18"/>` +
      glyph(cue.title ?? "Assistant", 82, 55, ui(30, 700), LEARNING.ink) +
      `<line x1="0" x2="${w}" y1="${C.header}" y2="${C.header}" stroke="${LEARNING.ink}" stroke-opacity="0.08" stroke-width="2"/>` +
      `<rect x="${C.fieldGap}" y="${field.top}" width="${w - 2 * C.fieldGap}" height="${C.field}" rx="44" fill="none" stroke="${LEARNING.ink}" stroke-opacity="0.25" stroke-width="2"/>` +
      `<circle cx="${w - C.fieldGap - 44}" cy="${field.top + C.field / 2}" r="32" fill="${LEARNING.ink}" fill-opacity="0.2"/>`;
    const motion = [...rise(".ct", 0, { distance: 30 })];
    let pieces = unit("ct-placeholder", glyph("Message", C.fieldGap + 30, field.baseline, field.font, LEARNING.ink, ' fill-opacity="0.45"'));
    if (first) {
      const typed = typedText(
        "ct-field",
        first.text,
        field.font,
        [C.fieldGap + 30, field.baseline],
        [field.top, field.top + C.field],
        first.at,
        first.typeStep,
      );
      pieces += typed.html;
      motion.push(
        hide(".ct-placeholder", first.at),
        ...typed.motion,
        hide(".ct-field", first.sendAt),
        fade(".ct-placeholder", first.sendAt, { duration: 0.2, later: true }),
      );
    }
    messages.forEach((message) => {
      const name = `ct-msg${message.index}`;
      const origin = [message.left + message.width / 2, message.top + message.height / 2];
      if (message.from === "assistant") {
        const words = stream(message, { x: message.left + C.padX, y: message.top + C.padY + 0.78 * C.size });
        pieces += unit(`${name} pre`, bubble(message), origin) + words.html;
        motion.push(...words.motion, {
          target: `.${name}`,
          at: message.at,
          from: { opacity: 0, scale: 0.9 },
          to: { opacity: 1, scale: 1, ...spring("snappy") },
        });
        return;
      }
      const text = message.lines
        .map((words, row) =>
          glyph(words.join(" "), message.left + C.padX, message.top + C.padY + row * message.step + 0.78 * C.size, message.font, message.style.text),
        )
        .join("");
      const at = message === first ? message.sendAt : message.at;
      const rising = message === first ? field.baseline - (message.top + C.padY + 0.78 * C.size) : 24;
      pieces += unit(`${name} pre`, bubble(message) + text, origin);
      motion.push(...flyUp(`.${name}`, at, rising));
    });
    const card =
      `<div class="box ct" style="left:${num(x)}px;top:${num(y)}px;width:${w}px;height:${num(h)}px;border-radius:32px;background:#FFFFFF;overflow:hidden;` +
      `box-shadow:${S.shadow}">${unit("ct-head", head)}${pieces}</div>`;
    return { html: card, motion, exit: fadeOut(".ct", duration) };
  },
};

module.exports = { chatThread };
