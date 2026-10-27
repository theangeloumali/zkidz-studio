// Created by The Angelo Umali.
// Brand titles (canvas brand-titles.js and banners.js): the hook over the footage, the name plate with its woven Z, the
// chapter card that wipes open, and the end card. Canvas layout and beats; the effects ride on top.
const { unit } = require("../brand/html");
const { exit, pop, hide } = require("../fx/motion");
const { tracking } = require("../fx/kinetic");
const { scrim, lightLeak } = require("../fx/light");
const { spring, springAlpha } = require("../fx/springs");
const { k, drawn, join, NOTHING, card, goldRule, lineLanded, lineWithNode, risingWords, risingText, kicker, written, zMark, typed } = require("./parts");

// Opening title: a light leak sweeps the frame and a scrim dims the band; the kicker tab rises, the serif lines punch in
// word by word, and one gold rule draws on under them. With `intro: true` the brand intro goes in when this hook ends.
// `settled` (a cover) rings the rule's node once instead of pulsing it, so no cover catches a ring.
const hookTitle = {
  render(cue, { duration, settled }) {
    const { HOOK } = k;
    const layout = k.hookLayout(cue);
    const block = join(
      cue.kicker ? kicker(cue, "kicker", cue.kicker, k.SAFE.left, layout.kickerBaseline, 0, { onFootage: true, size: HOOK.kicker }) : NOTHING,
      ...layout.lines.map(({ text, start, baseline, color }, index) =>
        risingWords(cue, `line${index}`, text, k.SAFE.left, baseline, layout.font, start, { outline: layout.outline, color, step: HOOK.step }),
      ),
      goldRule(cue, "rule", k.SAFE.left, layout.rule.y, layout.rule.width, HOOK.rule, { onFootage: true, pulseUntil: settled ? undefined : duration }),
    );
    const band = [k.SAFE.left, layout.top, layout.rule.width, layout.rule.y - layout.top + 30];
    return join(lightLeak("leak", 0, { bottom: k.SAFE.columnTop }), scrim("dim", band, 0, duration, { strength: 0.6 }), block);
  },
  // Seconds from the cue's start until its last word and its rule have landed.
  landed(cue) {
    const last = k.hookLayout(cue).lines.at(-1);
    const lastWord = last.start + (last.text.split(" ").length - 1) * k.HOOK.step;
    return Math.max(lastWord + spring().duration, lineLanded(k.HOOK.rule));
  },
};

// Name plate: the woven Z writes itself, the name rises, the kicker's tracking settles 0.32 to 0.18 em, a gold rule runs
// along the bottom edge.
const lowerThird = {
  render(cue, { duration }) {
    const { PLATE } = k;
    const { nameFont, roleFont, kickerText, width, baselines } = k.plateLayout(cue);
    const textMax = width - PLATE.textX - 30;
    const name = { ...nameFont, size: k.fitFontSize(cue.name, nameFont, textMax) };
    const size = k.PLATE_KICKER.size;
    const plateKicker = {
      html: drawn(cue, "plate-kicker", (s) =>
        s.trackedText(kickerText, PLATE.textX, baselines.kicker, k.PLATE_KICKER, 0.18, { color: k.BRAND.muted, wobble: 0 }),
      ),
      motion: [
        tracking(".plate-kicker text", 0.55, 0.32 * size, 0.18 * size),
        { target: ".plate-kicker", at: 0.55, from: { opacity: 0 }, to: { opacity: 1, ...springAlpha() } },
      ],
    };
    const role = cue.role && { ...roleFont, size: k.fitFontSize(cue.role, roleFont, textMax) };
    const content = join(
      zMark(cue, "z", 30, (PLATE.height - PLATE.mark) / 2, PLATE.mark, PLATE.zStart),
      risingWords(cue, "name", cue.name, PLATE.textX, baselines.name, name, 0.3),
      role ? risingText(cue, "role", cue.role, PLATE.textX, baselines.role, role, 0.45, { color: k.BRAND.lineStrong }) : NOTHING,
      plateKicker,
      goldRule(cue, "rule", 0, PLATE.height, width, 0.6, { thickness: 3 }),
    );
    return card(cue, "plate", [k.SAFE.left, cue.y ?? PLATE.top, width, PLATE.height], content, { duration, style: "flyLeft" });
  },
};

// Chapter card: the panel wipes open from the left with a gold edge riding the clip (standard spring), and wipes out right.
const chapterCard = {
  render(cue, { duration }) {
    const { CHAPTER } = k;
    const { height, top, lineStart, titleFont, subFont } = k.chapterLayout(cue);
    const width = k.PANEL_W;
    const balloonAt = [CHAPTER.balloonX, CHAPTER.rowY];
    const content = join(
      cue.index !== undefined
        ? { html: drawn(cue, "balloon", (s) => s.numberBalloon(cue.index, ...balloonAt, CHAPTER.balloon, 1), balloonAt), motion: [pop(".balloon", 0.2)] }
        : NOTHING,
      lineWithNode(cue, "stem", [lineStart, CHAPTER.rowY], CHAPTER.stem, (s, withNode) => s.drawChapterStem(lineStart, 1, withNode ? 1 : 0), 0.3, {
        appear: (target, at) => pop(target, at),
      }),
      cue.kicker ? kicker(cue, "kicker", cue.kicker, lineStart + 124, CHAPTER.rowY + 10, 0.35) : NOTHING,
      risingWords(cue, "title", cue.title, k.CARD_PAD, CHAPTER.title, titleFont, 0.25),
      subFont ? risingText(cue, "sub", cue.sub, k.CARD_PAD, CHAPTER.sub, subFont, 0.55, { color: k.BRAND.muted }) : NOTHING,
    );
    const sheet = card(cue, "panel", [k.SAFE.left, top, width, height], content, { lift: false, duration });
    const leak = lightLeak("leak", 0);
    // The canvas clip runs 6 px left of the card to (PANEL_W + 20) * open, and 12 px above to 18 px below it.
    const window = (left, right) => `inset(-12px ${width - right}px -18px ${left}px)`;
    const travel = spring();
    return {
      html: leak.html + sheet.html + drawn(cue, "edge", (s) => s.wipeEdge(k.SAFE.left, top - 4, height + 8)),
      motion: [
        ...leak.motion,
        { target: ".panel", at: 0, from: { clipPath: window(-6, 0) }, to: { clipPath: window(-6, width + 20), ...travel } },
        { target: ".edge", at: 0, from: { x: 0 }, to: { x: width + 20, ...travel } },
        // The canvas stops drawing the edge once the panel is 0.98 open.
        hide(".edge", k.settleTime(k.SPRING.standard, 0.98)),
        ...sheet.motion,
      ],
      exit: [
        {
          target: ".panel",
          at: duration - CHAPTER.wipeOut,
          from: { clipPath: window(-6, width + 20) },
          to: { clipPath: window(width + 14, width + 20), duration: CHAPTER.wipeOut, ease: "power2.in", immediateRender: false },
        },
      ],
    };
  },
};

// End card: the paper card lifts on the heavy spring, its gold rule draws and breathes, the Z writes itself, the wordmark
// rises and the call to action types. A `scale` shrinks the whole lockup about its top centre.
const endCard = {
  render(cue, { duration }) {
    const { END_CARD, PULSE } = k;
    const layout = k.endCardLayout(cue);
    const { top, scale, centre, wordmark, kicker: label, cta, sign } = layout;
    const markHeight = END_CARD.markHeight;
    const z = zMark(cue, "z", centre - k.zMarkWidth(markHeight) / 2, layout.markTop, markHeight, END_CARD.markAt);
    const rule = goldRule(cue, "rule", ...layout.rule, 0);
    const content = join(
      {
        html: rule.html,
        // Breathes once grown, as the canvas pulse does: from full, down to PULSE.min and back every PULSE.period.
        motion: [
          ...rule.motion,
          {
            target: ".rule-line, .rule-node",
            at: layout.pulseAfter,
            from: { opacity: PULSE.max },
            to: {
              opacity: PULSE.min,
              duration: PULSE.period / 2,
              ease: "sine.inOut",
              yoyo: true,
              repeat: Math.ceil(duration / (PULSE.period / 2)),
              immediateRender: false,
            },
          },
        ],
      },
      {
        html: unit("zgroup", "", [centre, layout.markTop + markHeight / 2], z.html),
        motion: [{ target: ".zgroup", at: END_CARD.markAt, from: { scale: 0.9 }, to: { scale: 1, ...spring("heavy") } }, ...z.motion],
      },
      risingWords(cue, "word", wordmark.text, centre, wordmark.baseline, k.WORDMARK_FONT, wordmark.at, { align: "center" }),
      kicker(cue, "kicker", label.text, centre - k.kickerWidth(label.text, { size: label.size }) / 2, label.baseline, label.at, { size: label.size }),
      cta ? typed(cue, "cta", cue.cta, cta.left, cta.baseline, cta.font, END_CARD.ctaAt, duration, { cps: END_CARD.cps, color: k.BRAND.ink }) : NOTHING,
    );
    const sheet = card(cue, "card", [k.PW / 2 - centre, top, END_CARD.w, END_CARD.h], content, { duration, style: "drop", dim: 0 });
    const lockup = scale === 1 ? sheet.html : `<div class="u" style="transform-origin:${k.PW / 2}px ${top}px;transform:scale(${scale})">${sheet.html}</div>`;
    // The scrim and the leak sit outside the scaled lockup, sized to the card as it shows on screen.
    const shown = [k.PW / 2 - centre * scale, top, END_CARD.w * scale, END_CARD.h * scale];
    const stage = join(lightLeak("leak", 0.1), scrim("dim", shown, 0, duration));
    const signOff = sign
      ? written(cue, "sign", cue.sign, k.PW / 2, sign.y, sign.font, k.penSpan(cue.sign, sign.start), { align: "center", rot: -0.02 })
      : NOTHING;
    return {
      html: stage.html + lockup + signOff.html,
      motion: [...stage.motion, ...sheet.motion, ...signOff.motion],
      exit: [...sheet.exit, ...(sign ? exit(".sign", duration) : [])],
    };
  },
};

module.exports = { hookTitle, lowerThird, chapterCard, endCard };
