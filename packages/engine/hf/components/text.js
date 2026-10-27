// Created by The Angelo Umali.
// Words as devices (canvas brand-titles.js, labels.js, brand-flow.js): the keyword pop-up in its three tones, the
// handwritten note, the slammed stamp and the title swap. Canvas layout and beats; the effects ride on top.
const { unit, drawable } = require("../brand/html");
const { rise, fade, pop, hide } = require("../fx/motion");
const { slideIn } = require("../fx/paper");
const { drawOn } = require("../fx/ink");
const { slam, shake, wobble, burst } = require("../fx/impact");
const { scrim, flash } = require("../fx/light");
const { k, still, drawn, after, join, NOTHING, idOf, card, goldRule, risingWords, written, kicker, highlighter, arrow } = require("./parts");

// Keyword pop-up: serif on the footage, a paper card (an accent gets a gold marker swipe and rule), or a mono chip.
const keyword = {
  render(cue, { duration }) {
    const box = k.keywordBox(cue);
    const { tone, y, font, pad, boxWidth, left } = box;
    if (tone === "chip") {
      const chip = drawn(
        cue,
        "chip",
        (s) => s.drawScaled(left, box.middle - box.chipHeight / 2, box.chipScale, () => s.drawChip(0, 0, cue.text, cue.accent ? k.HOT_CHIP : {})),
        [left + boxWidth / 2, box.middle],
      );
      return { html: chip, motion: [...slideIn(".chip", 0, { preset: "snappy" }), pop(".chip", 0, "snappy", { from: 0.9 })] };
    }
    if (tone === "paper") {
      const baseline = box.paperBaseline;
      const content = join(
        cue.accent ? highlighter(cue, "mark", [pad - 8, baseline - font.size * 0.5, boxWidth - 2 * pad + 16, font.size * 0.52], 0.3) : NOTHING,
        risingWords(cue, "words", cue.text, pad, baseline, font, 0.1, { step: 0.08 }),
        cue.accent ? goldRule(cue, "rule", pad, baseline + font.size * 0.3, boxWidth - 2 * pad, k.KEYWORD.accent, { thickness: 4 }) : NOTHING,
      );
      const paper = card(cue, "card", [left, y - baseline, boxWidth, box.paperHeight], content, { duration });
      return paper;
    }
    return join(
      scrim("dim", [left, y - font.size, boxWidth, font.size * 1.5], 0, duration, { strength: 0.5 }),
      risingWords(cue, "words", cue.text, left, y, font, 0, { step: 0.08, outline: Math.round(font.size * 0.13) }),
      cue.accent ? goldRule(cue, "rule", left, y + font.size * 0.32, boxWidth, k.KEYWORD.accent, { onFootage: true, pulseUntil: duration }) : NOTHING,
    );
  },
};

// Comment prompt: a speech bubble pops in and the question writes on inside it in Caveat.
const comment = {
  render(cue) {
    const { font, x, y, bubble: shape, textY, textWidth } = k.commentLayout(cue);
    const bubble = drawn(cue, "bubble", (s) => s.drawScaled(x, y, 1, () => s.drawSpeechBubble(...shape)));
    const words = written(cue, "words", cue.text, x, y + textY, font, k.penSpan(cue.text, 0.2), {
      plain: true,
      align: "center",
      maxWidth: textWidth,
      wobble: 0.6,
    });
    return {
      html: unit("comment", "", [x, y], bubble + words.html),
      motion: [...rise(".comment", 0, { preset: "snappy", distance: 30, scaleFrom: 0.8, blur: 8 }), ...words.motion],
    };
  },
};

// Handwritten note: each line writes on at the pen's pace; an old phrase is struck through first, an arrow draws to its
// target. The canvas draws it in note space, about (x, y).
const handNote = {
  render(cue) {
    const layout = k.handNoteLayout(cue);
    const { x, y, font, align, rot, lines, lineGap } = layout;
    const inNote = (draw) => (s) => s.drawScaled(x, y, 1, () => draw(s));
    const strike = cue.strike ? struckPhrase(cue, layout, inNote) : NOTHING;
    const pointer = cue.arrow
      ? arrow(cue, "arrow", (s, progress) => s.drawScaled(x, y, 1, () => s.drawHandArrow(cue, layout, progress)), k.HAND_ARROW)
      : NOTHING;
    const note = join(
      strike,
      ...k.handLineSpans(cue).map((span, index) => written(cue, `line${index}`, lines[index], x, y + index * lineGap, font, span, { align, rot })),
      pointer,
    );
    return { html: unit("note", "", [x, y], note.html), motion: [...rise(".note", 0, { distance: 0, scaleFrom: 1 }), ...note.motion] };
  },
};

// The old phrase above the note, then its negative strike drawing on across HAND_STRIKE.
function struckPhrase(cue, layout, inNote) {
  const phrase = still(
    cue,
    "strike",
    inNote((s) => s.drawHandStrike(cue, layout, 0)),
  );
  const line = after(
    phrase,
    still(
      cue,
      "strike",
      inNote((s) => s.drawHandStrike(cue, layout, 1)),
    ),
    "drawHandStrike",
  );
  const [start, end] = k.HAND_STRIKE;
  return {
    html: unit("strike", phrase) + unit("strike-line", drawable(line)),
    motion: [drawOn(".strike-line path", start, { duration: end - start, ease: "none" })],
  };
}

// Rubber stamp: slams in from 2.6x with motion blur, lands with the canvas settle, a seeded jolt, the gold burst and a
// spray of its own ink.
const slamStamp = {
  render(cue) {
    const layout = k.stampLayout(cue);
    const color = cue.color ?? k.TEAM.bad;
    const centre = [cue.x, cue.y];
    const contact = k.SLAM_CONTACT;
    const face = still(cue, "stamp", (s, ctx) => {
      ctx.save();
      ctx.translate(...centre);
      ctx.rotate(cue.rot ?? -0.08);
      s.drawStampFace(cue, layout, color);
      ctx.restore();
    });
    const ink = burst("drop", cue.seed, centre, contact, {
      count: 22,
      colour: color,
      reach: [layout.boxW * 0.45, layout.boxW * 0.95],
      size: [5, 13],
      idPrefix: idOf(cue, "drop"),
    });
    const hit = flash("flash", contact, { peak: 0.45 });
    return {
      html:
        unit("spokes", drawable(still(cue, "spokes", (s) => s.drawStampBurst(...centre, layout.boxW, 1))), centre) +
        ink.html +
        unit("stamp", "", centre, unit("jolt", "", centre, unit("settle", face, centre))) +
        hit.html,
      motion: [
        ...slam(".stamp", 0, contact),
        shake(".jolt", contact, cue.seed, { amplitude: 22, duration: 0.5 }),
        wobble(".settle", contact),
        // The canvas burst grows from just before contact until 0.5 s, then is gone.
        drawOn(".spokes path", contact - 0.02, { duration: 0.5 - contact + 0.02, ease: "power2.out" }),
        hide(".spokes", 0.5),
        ...ink.motion,
        ...hit.motion,
      ],
    };
  },
};

// Title swap: the old title is struck in the negative and steps back to muted, a steel arrow leads down, the new title
// rises in over a gold rule.
const titleSwap = {
  render(cue, { duration }) {
    const { SWAP } = k;
    const at = k.swapAt(cue);
    const layout = k.swapLayout(cue);
    const { oldFont, newFont, oldBaseline, newBaseline, width, height } = layout;
    const oldTitle = (color) => (s) => s.riseText(cue.old, k.CARD_PAD, oldBaseline, oldFont, { alpha: 1, dy: 0 }, { color });
    const [ruleX, ruleY, ruleWidth] = k.swapRule(cue, layout);
    const content = join(
      cue.label ? kicker(cue, "label", cue.label, k.CARD_PAD, k.HEAD_KICKER, 0.1) : NOTHING,
      {
        html:
          drawn(cue, "old", oldTitle(k.BRAND.ink), [k.CARD_PAD, oldBaseline]) +
          drawn(cue, "old-muted", oldTitle(k.BRAND.muted), [0, 0], { pre: true }) +
          unit("strike", drawable(still(cue, "strike", (s) => s.drawSwapStrike(cue, layout, 1)))),
        motion: [
          ...rise(".old", 0.15, { distance: 16, scaleFrom: 1 }),
          fade(".old-muted", at, { duration: 0.2 }),
          { target: ".old", at, from: { opacity: 1 }, to: { opacity: 0, duration: 0.2, ease: "power2.out", immediateRender: false } },
          drawOn(".strike path", at, { duration: SWAP.strike, ease: "power2.inOut" }),
        ],
      },
      arrow(cue, "arrow", (s, progress) => s.drawSwapArrow(layout, progress), [at + SWAP.arrow[0], at + SWAP.arrow[1]]),
      risingWords(cue, "new", cue.new, k.CARD_PAD + SWAP.indent, newBaseline, newFont, at + SWAP.words),
      goldRule(cue, "rule", ruleX, ruleY, ruleWidth, at + SWAP.rule, { thickness: 4 }),
    );
    return card(cue, "card", [k.SAFE.left, k.bandTop(cue.y, height), width, height], content, { duration });
  },
};

module.exports = { keyword, comment, handNote, slamStamp, titleSwap };
