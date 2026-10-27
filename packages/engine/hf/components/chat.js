// Created by The Angelo Umali.
// A chat as a paper card in the top band: the speaker's bubbles steel on the right, the reply's ink on the left behind an
// avatar disc. Bubbles grow from their sender's side on their word pins; a streamed reply arrives word by word; three
// typing dots can close it. It draws only the words the cue gives.
const { rise } = require("../fx/motion");
const { k, drawn, join, NOTHING, panelCard, head, goldRule, avatarDisc } = require("./parts");

const CHAT = {
  font: { ...k.TYPE.body, size: 38 },
  lineGap: 50,
  padX: 28,
  padY: 20,
  radius: 26,
  tail: 6, // the sender-side bottom corner stays nearly square
  gap: 18,
  maxText: 720,
  avatar: 24,
  top: 100, // first bubble, below the kicker
  step: 0.9, // unpinned messages
  stream: 0.08, // seconds per streamed word
  typing: { w: 132, h: 70, dot: 7, gap: 26, hop: 10, cycle: 0.9 },
};
const NBSP = " ";

// A rounded rect as a closed polyline, corner radii [top-left, top-right, bottom-right, bottom-left].
function roundedPoints(x, y, w, h, radii) {
  const corners = [
    [x + radii[0], y + radii[0], Math.PI],
    [x + w - radii[1], y + radii[1], -Math.PI / 2],
    [x + w - radii[2], y + h - radii[2], 0],
    [x + radii[3], y + h - radii[3], Math.PI / 2],
  ];
  const points = corners.flatMap(([cx, cy, from], index) =>
    Array.from({ length: 7 }, (_, step) => {
      const angle = from + (Math.PI / 2) * (step / 6);
      return [cx + Math.cos(angle) * radii[index], cy + Math.sin(angle) * radii[index]];
    }),
  );
  return [...points, points[0]];
}

// The phrase wraps as one word, so its gold rule never breaks across lines.
function wrapped(text, phrase) {
  const at = phrase ? text.toLowerCase().indexOf(phrase.toLowerCase()) : -1;
  const glued = at < 0 ? text : text.slice(0, at) + text.slice(at, at + phrase.length).replaceAll(" ", NBSP) + text.slice(at + phrase.length);
  return { lines: k.wrapLines(glued, CHAT.font, CHAT.maxText).map((line) => line.replaceAll(NBSP, " ")), accent: at >= 0 };
}

function chatLayout(cue) {
  const { padX, padY, lineGap, font, gap, avatar } = CHAT;
  const right = k.PANEL_W - k.CARD_PAD;
  const replyLeft = k.CARD_PAD + 2 * avatar + 16;
  let y = CHAT.top;
  let accentTaken = false;
  const bubbles = cue.messages.map((message, index) => {
    const mine = message.from === "me";
    const { lines, accent } = wrapped(message.text, accentTaken ? null : cue.accentPhrase);
    accentTaken ||= accent;
    const w = Math.max(...lines.map((line) => k.textWidth(line, font))) + 2 * padX;
    const h = 2 * padY + (lines.length - 1) * lineGap + font.size;
    const bubble = {
      index,
      mine,
      lines,
      accent,
      x: mine ? right - w : replyLeft,
      y,
      w,
      h,
      at: message.at ?? 0.4 + index * CHAT.step,
      stream: !mine && cue.stream,
    };
    y += h + gap;
    return bubble;
  });
  if (cue.accentPhrase && !accentTaken) throw new Error(`chatCard accentPhrase "${cue.accentPhrase}" is in none of its messages`);
  const lastAt = bubbles.length ? bubbles.at(-1).at : 0;
  const typing = cue.typing ? { x: replyLeft, y, w: CHAT.typing.w, h: CHAT.typing.h, mine: false, at: cue.typingAt ?? lastAt + 0.8 } : null;
  const bottom = typing ? y + CHAT.typing.h : y - gap;
  return { bubbles, typing, height: bottom + k.CARD_PAD * 0.7 };
}

const baselineOf = (bubble, row) => bubble.y + CHAT.padY + CHAT.font.size * 0.78 + row * CHAT.lineGap;

function bubbleShape(s, { x, y, w, h, mine }, fill) {
  const { radius, tail } = CHAT;
  s.wobblyFill(roundedPoints(x, y, w, h, mine ? [radius, radius, tail, radius] : [radius, radius, radius, tail]), fill);
}

// A bubble grows from its sender's bottom corner: 0.75 to 1 on the snappy spring.
const grow = (target, at) => rise(target, at, { preset: "snappy", distance: 14, scaleFrom: 0.75 });
const avatar = (cue, name, { y, h }, at) => avatarDisc(cue, name, { x: k.CARD_PAD + CHAT.avatar, y: y + h - CHAT.avatar, radius: CHAT.avatar, at });

// A streamed line is one unit per word inside the bubble, so the words grow with it and fade in on a stagger.
function messageBubble(cue, bubble) {
  const name = `m${bubble.index}`;
  const ink = { ...CHAT.font, color: bubble.mine ? k.BRAND.white : k.BRAND.copyOnInk, wobble: 0.2 };
  const left = bubble.x + CHAT.padX;
  const words = bubble.stream
    ? bubble.lines.flatMap((line, row) => {
        const parts = line.split(" ");
        return parts.map((word, column) => {
          const x = left + (column ? k.textWidth(`${parts.slice(0, column).join(" ")} `, CHAT.font) : 0);
          const baseline = baselineOf(bubble, row);
          return drawn(cue, `${name}-w${row}-${column}`, (s) => s.drawText(word, x, baseline, ink), [x, baseline], { pre: true }).replace(
            'class="u ',
            `class="u ${name}-word stream `,
          );
        });
      })
    : [];
  const body = (s) => {
    bubbleShape(s, bubble, bubble.mine ? k.BRAND.steel : k.BRAND.ink);
    if (!bubble.stream) bubble.lines.forEach((line, row) => s.drawText(line, left, baselineOf(bubble, row), ink));
  };
  const origin = [bubble.mine ? bubble.x + bubble.w : bubble.x, bubble.y + bubble.h];
  const streamAt = bubble.at + 0.15;
  const reveal = {
    keyframes: [
      { opacity: 0, duration: 0 },
      { opacity: 1, duration: 0.12, ease: "power1.out" },
    ],
    stagger: CHAT.stream,
  };
  const streamed = words.length ? [{ target: `.${name}-word.stream`, at: streamAt, to: reveal }] : [];
  const landed = bubble.stream ? streamAt + words.length * CHAT.stream : bubble.at + 0.35;
  return join(
    { html: drawn(cue, name, body, origin, { inner: words.join("") }), motion: [...grow(`.${name}`, bubble.at), ...streamed] },
    bubble.mine ? NOTHING : avatar(cue, `${name}-avatar`, bubble, bubble.at),
    bubble.accent ? accentRule(cue, bubble, landed) : NOTHING,
  );
}

// The gold rule under the accent phrase, drawing on once its words are on screen.
function accentRule(cue, bubble, at) {
  const phrase = cue.accentPhrase.toLowerCase();
  const row = bubble.lines.findIndex((line) => line.toLowerCase().includes(phrase));
  const line = bubble.lines[row];
  const start = line.toLowerCase().indexOf(phrase);
  const x = bubble.x + CHAT.padX + k.textWidth(line.slice(0, start), CHAT.font);
  const width = k.textWidth(line.slice(start, start + phrase.length), CHAT.font);
  return goldRule(cue, "accent", x, baselineOf(bubble, row) + 14, width, at, { onFootage: true, thickness: 4, node: false });
}

// The reply's typing row: an ink bubble whose three dots hop in turn until the card leaves.
function typingRow(cue, typing, duration) {
  const { dot, gap, hop, cycle } = CHAT.typing;
  const middle = typing.y + typing.h / 2;
  const firstX = typing.x + typing.w / 2 - gap;
  const dots = [0, 1, 2].map((index) => {
    const x = firstX + index * gap;
    return drawn(cue, `dot${index}`, (s) => s.sketchEllipse(x, middle, dot, dot, { fill: k.BRAND.mutedOnInk, stroke: false }), [x, middle]);
  });
  const repeat = Math.max(0, Math.floor((duration - 0.5 - typing.at) / cycle) - 1);
  return join(
    {
      html: drawn(cue, "typing", (s) => bubbleShape(s, typing, k.BRAND.ink), [typing.x, typing.y + typing.h], { inner: dots.join("") }),
      motion: [
        ...grow(".typing", typing.at),
        ...[0, 1, 2].map((index) => ({
          target: `.dot${index}`,
          at: typing.at + 0.3 + index * 0.15,
          to: {
            keyframes: [
              { y: 0, duration: 0 },
              { y: -hop, duration: 0.2, ease: "sine.out" },
              { y: 0, duration: 0.2, ease: "sine.in" },
            ],
            repeat,
            repeatDelay: cycle - 0.4,
          },
        })),
      ],
    },
    avatar(cue, "typing-avatar", typing, typing.at),
  );
}

const chatCard = {
  sfx: (cue, duration) => {
    const { bubbles, typing } = chatLayout(cue);
    return k.cardSfx(duration, [
      ...bubbles.map((bubble) => ({ at: bubble.at, sound: "tick", pan: bubble.mine ? 0.25 : -0.25 })),
      ...(typing ? [{ at: typing.at, sound: "tick", pan: -0.25 }] : []),
    ]);
  },
  render(cue, { duration }) {
    const { bubbles, typing, height } = chatLayout(cue);
    const content = join(
      cue.title ? head(cue, cue.title, null, {}) : NOTHING,
      ...bubbles.map((bubble) => messageBubble(cue, bubble)),
      typing ? typingRow(cue, typing, duration) : NOTHING,
    );
    return panelCard(cue, cue.y, height, content, { accent: !cue.accentPhrase, duration });
  },
};

module.exports = { chatCard, roundedPoints };
