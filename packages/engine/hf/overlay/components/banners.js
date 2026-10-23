// Created by The Angelo Umali.
// Larger pieces: round banners, info cards, agent tags, the comment bubble and the end card.

// Woven-Z draw-on beats (spec §5.1) from `start`: steel node, steel stroke, gold stroke, gold node and its glow.
// Seconds from the Z's start: each bar's draw window, when the gold node pops, and how long its glow lasts.
const Z_BEATS = { steel: [0.08, 0.55], gold: [0.3, 0.78], goldNode: 0.72, glow: 0.5 };
const Z_GOLD_NODE_AT = Z_BEATS.goldNode;
const brandZTiming = (local, start = 0) => {
  const elapsed = local - start;
  return {
    steelNode: springAt(elapsed, SPRING.snappy),
    steel: ease.inOut(span(elapsed, ...Z_BEATS.steel)),
    gold: ease.inOut(span(elapsed, ...Z_BEATS.gold)),
    goldNode: springAt(elapsed - Z_GOLD_NODE_AT, SPRING.snappy),
    glow: span(elapsed, Z_GOLD_NODE_AT, Z_GOLD_NODE_AT + Z_BEATS.glow),
  };
};
const zMarkWidth = (height) => (height * Z_LOGO.width) / Z_LOGO.height;

// Gold edge riding a clip wipe (the films' tinted wipe, as on the chapter card).
const wipeEdge = (x, top, height) => sketchLine(x, top, x, top + height, { color: BRAND.goldBright, width: 6, passes: 1, rough: 0.8, overshoot: 0 });

// Full-width ink band, clip-wiped in from the left and out to the right.
const BAND_WIPE_OUT = 0.25;

COMPONENTS.roundCard = (cue, env) => {
  const { local, duration } = env;
  const top = cue.y ?? SAFE.top;
  const height = 260;
  const reveal = springAt(local);
  const wipeOut = ease.in(span(local, duration - BAND_WIPE_OUT, duration));
  const titleFont = { ...TYPE.display, size: 96 };
  titleFont.size = fitFontSize(cue.text, titleFont, PANEL_W);
  ctx.save();
  ctx.beginPath();
  ctx.rect(PW * wipeOut, top - 20, PW * Math.max(0, reveal - wipeOut), height + 60);
  ctx.clip();
  brandCard(-20, top, PW + 40, height, { tone: "ink" });
  kicker(cue.round, SAFE.left, top + 62, local, 0.15, { color: BRAND.goldBright });
  const titleWidth = wordsRise(cue.text, SAFE.left, top + 165, titleFont, local, 0.2, { color: BRAND.copyOnInk });
  goldRule(SAFE.left, top + 192, titleWidth, springAt(local - 0.5), { onFootage: true, thickness: 4 });
  if (cue.sub) riseText(cue.sub, SAFE.left, top + 236, { ...TYPE.mono, size: 34 }, riseIn(local, 0.45, { distance: 18 }), { color: BRAND.mutedOnInk });
  ctx.restore();
  if (reveal < 0.98) wipeEdge(PW * reveal, top, height);
  if (wipeOut > 0) wipeEdge(PW * wipeOut, top, height);
};

// Plucks land at 0.25 / 0.37 s, as the band settles.
SFX_OF.roundCard = (cue, duration) => [
  { at: -0.1, sound: "chapter" },
  { at: duration - BAND_WIPE_OUT, sound: "swishOut" },
];

// Card in the top band: kicker, serif title and circuit-node bullet lines.
COMPONENTS.infoCard = (cue, env) => {
  const { local } = env;
  const titleFont = { ...TYPE.display, size: 66 };
  const lineFont = { ...TYPE.body, size: 40 };
  const titleLead = titleFont.size * 1.08;
  const textLeft = 50;
  const titleLines = wrapLines(cue.title, titleFont, PANEL_W - textLeft - 40);
  const bodyLines = cue.lines ?? [];
  const height = 60 + (cue.kicker ? 50 : 0) + titleLines.length * titleLead + bodyLines.length * 56 + 30;
  panelCard(
    env,
    cue.y ?? SAFE.top + 30,
    height,
    () => {
      let cursor = 70;
      if (cue.kicker) {
        kicker(cue.kicker, textLeft, cursor, local, 0.1);
        cursor += 50;
      }
      linesRise(titleLines, textLeft, cursor + titleFont.size * 0.55, titleFont, titleLead, local, 0.2);
      cursor += titleLines.length * titleLead + 10;
      bodyLines.forEach((line, index) => {
        const start = staggerAt(index, 0.3, 0.4);
        const rowY = cursor + 40 + index * 56;
        nodeRing(textLeft + 9, rowY - 12, 9, { pop: springAt(local - start, SPRING.snappy), surface: BRAND.paper });
        riseText(line, textLeft + 34, rowY, lineFont, riseIn(local, start + 0.05, { distance: 18 }));
      });
    },
    cardAccent(local),
  );
};

SFX_OF.infoCard = (cue, duration) => cardSfx(duration);

// Speech bubble asking viewers to comment; the question writes on in Caveat. The bubble sits about (x, y), the question's
// baseline textY below; hf/components/text.js lays its comment out with this too.
function commentLayout(cue) {
  const font = { ...TYPE.hand, size: 76 };
  const width = Math.min(PANEL_W, textWidth(cue.text, font) + 140);
  return { font, x: PW / 2, y: cue.y ?? 420, bubble: [-width / 2, -130, width, 250, -width * 0.05, 190], textY: 25, textWidth: width - 100 };
}

COMPONENTS.comment = (cue, env) => {
  const layout = commentLayout(cue);
  withMotion(layout.x, layout.y, env, () => {
    drawStill(() => drawSpeechBubble(...layout.bubble));
    drawText(cue.text, 0, layout.textY, {
      ...layout.font,
      align: "center",
      maxWidth: layout.textWidth,
      wobble: 0.6,
      reveal: span(env.local, ...penSpan(cue.text, 0.2)),
    });
  });
};

SFX_OF.comment = (cue, duration) => cardSfx(duration);

// Signature lockup (spec §5.8): gold rule, woven Z, wordmark, kicker, then the CTA typed on.
// `scale` shrinks it about its top centre (`y`) so a compact card clears the face; the CTA keeps ctaMinPx on screen.
// The sign shrinks with it: at 72 px its ink is ~92 px tall, too tall for the band between his chin and y 1248.
const END_CARD = { y: 330, w: 850, h: 650, signGap: 80, signSize: 72, ctaSize: 40, ctaMinPx: 36, markHeight: 220, markAt: 0.1, ctaAt: 1.1, cps: 20 };
const WORDMARK_FONT = themed(() => ({ ...TYPE.display, size: 84, tracking: 84 * 0.02 }));

// Card-space places (the card is centre-anchored at the top, `scale`d) and the sign-off under it in page space.
function endCardLayout(cue) {
  const top = cue.y ?? END_CARD.y;
  const scale = cue.scale ?? 1;
  const centre = END_CARD.w / 2;
  const ctaFont = cue.cta && { ...TYPE.label, size: Math.max(END_CARD.ctaSize, END_CARD.ctaMinPx / scale) };
  if (ctaFont) ctaFont.size = fitFontSize(`${cue.cta}_`, ctaFont, END_CARD.w - 100);
  const signFont = cue.sign && { ...TYPE.hand, size: END_CARD.signSize * scale };
  if (signFont) signFont.size = fitFontSize(cue.sign, signFont, 2 * (SAFE.columnRight - PW / 2));
  return {
    top,
    scale,
    centre,
    rule: [centre - 120, 60, 240],
    pulseAfter: 0.5,
    markTop: 100,
    wordmark: { text: cue.text ?? "ZKidz Dev", baseline: 460, at: 0.55 },
    // A shrunk lockup keeps its kicker at the kicker size on screen.
    kicker: { text: cue.sub ?? "Software Engineering", baseline: 520, at: 0.75, size: TYPE.kicker.size / Math.min(1, scale) },
    cta: ctaFont && { font: ctaFont, left: centre - textWidth(cue.cta, ctaFont) / 2, baseline: 594 },
    sign: signFont && {
      font: signFont,
      y: cue.signY ?? top + (END_CARD.h + END_CARD.signGap) * scale,
      start: END_CARD.ctaAt + (cue.cta?.length ?? 0) / END_CARD.cps + 0.2,
    },
  };
}

function drawSignOff(cue, env, { sign }) {
  ctx.save();
  ctx.globalAlpha *= exitAlpha(env);
  strokedText(cue.sign, PW / 2, sign.y, sign.font, { align: "center", rot: -0.02, reveal: span(env.local, ...penSpan(cue.sign, sign.start)) });
  ctx.restore();
}

COMPONENTS.endCard = (cue, env) => {
  const { local } = env;
  const layout = endCardLayout(cue);
  const { top, scale, centre, wordmark, kicker: label, cta } = layout;
  withMotion(
    PW / 2,
    top,
    env,
    () =>
      drawScaled(0, 0, scale, () => {
        ctx.translate(-centre, 0);
        brandCard(0, 0, END_CARD.w, END_CARD.h);
        const rule = springAt(local);
        ctx.save();
        if (rule >= 0.99) ctx.globalAlpha *= pulse(local - layout.pulseAfter);
        goldRule(...layout.rule, rule);
        ctx.restore();
        const markScale = lerp(0.9, 1, springAt(local - END_CARD.markAt, SPRING.heavy));
        drawScaled(centre, layout.markTop + END_CARD.markHeight / 2, markScale, () =>
          drawBrandZ(-zMarkWidth(END_CARD.markHeight) / 2, -END_CARD.markHeight / 2, END_CARD.markHeight, brandZTiming(local, END_CARD.markAt)),
        );
        wordsRise(wordmark.text, centre, wordmark.baseline, WORDMARK_FONT, local, wordmark.at, { align: "center" });
        centredKicker(label.text, centre, label.baseline, local, label.at, { size: label.size });
        if (cta)
          drawText(typeOn(cue.cta, local, END_CARD.ctaAt, { cps: END_CARD.cps }), cta.left, cta.baseline, { ...cta.font, color: BRAND.ink, wobble: 0.2 });
      }),
    { preset: SPRING.heavy, distance: 30, scaleFrom: 0.92 },
  );
  if (cue.sign) drawSignOff(cue, env, layout);
};

// The sign-off chime starts as the Z's gold node pops.
SFX_OF.endCard = () => [{ at: END_CARD.markAt + Z_GOLD_NODE_AT, sound: "sign" }];
