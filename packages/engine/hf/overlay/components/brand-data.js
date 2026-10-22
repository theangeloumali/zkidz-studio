// Created by The Angelo Umali.
// Brand data cards: the counting stat tile and the funnel (the criteria card is in rows.js).
// Item `at`s (tiers, subAt) are source seconds after the cue's `at`; timemap.js maps them onto the edit.

// Stat tile (spec §3.3.6): an ink tile whose number counts up on the counter spring, a goldBright suffix popping
// in after it (the tile's one gold), a tracked label above and an optional sub line.
const STAT = { size: 150, countFrom: 0.25, suffixAt: 0.65, subAt: 0.9, labelFont: { ...TYPE.kicker, size: 34 } };
// Where the counter spring passes 0.99: countUp lands the exact value there, and the count SFX plucks.
const COUNTER_SETTLE = settleTime(SPRING.counter);
// A short tile counts faster, so the exact value always holds for 0.35 s before the exit starts.
const countSpeed = (duration) => Math.max(1, COUNTER_SETTLE / Math.max(0.3, duration - EXIT - 0.35 - STAT.countFrom));

function statLayout(cue) {
  const decimals = cue.decimals ?? 0;
  const parts = { prefix: cue.prefix ?? "", number: formatCount(cue.value, decimals), suffix: cue.suffix ?? "" };
  // A unit word sits small beside the number; a symbol (×, %, +) needs more size to read.
  const suffixScale = /[a-z]/i.test(parts.suffix) ? 0.42 : 0.8;
  const measure = (size) =>
    textWidth(parts.prefix + parts.number, { ...TYPE.display, size }) + textWidth(parts.suffix, { ...TYPE.display, size: size * suffixScale }) + 10;
  const size = Math.min(STAT.size, (STAT.size * CARD_INNER) / measure(STAT.size));
  const numberFont = { ...TYPE.display, size };
  const suffixFont = { ...TYPE.display, size: size * suffixScale };
  const subFont = { ...TYPE.body, size: 34 };
  const labelWidth = cue.label ? trackedWidth(cue.label.toUpperCase(), STAT.labelFont, STAT.labelFont.trackingEm) : 0;
  const contentWidth = Math.max(measure(size), labelWidth, cue.sub ? textWidth(cue.sub, subFont) : 0);
  const numberBaseline = (cue.label ? HEAD_KICKER + 26 : CARD_PAD) + size * 0.72;
  const subBaseline = numberBaseline + 58;
  const height = (cue.sub ? subBaseline : numberBaseline) + 40;
  // A count from 0 to 1 is not a count: small values just rise in whole.
  const counts = Math.abs(cue.value) * 10 ** decimals >= 3;
  return {
    decimals,
    parts,
    numberFont,
    suffixFont,
    subFont,
    // Right-aligned to the final value, so digits roll in leftwards and the suffix never moves.
    numberRight: CARD_PAD + textWidth(parts.prefix, numberFont) + textWidth(parts.number, numberFont),
    numberInk: { ...numberFont, color: BRAND.copyOnInk, wobble: 0 },
    suffixInk: { ...suffixFont, color: BRAND.goldBright, wobble: 0 },
    numberBaseline,
    subBaseline,
    height,
    counts,
    width: clamp(contentWidth + 2 * CARD_PAD, 360, PANEL_W),
  };
}

COMPONENTS.statTile = (cue, env) => {
  const { local } = env;
  const layout = statLayout(cue);
  const { parts, numberRight, numberInk, suffixInk, numberBaseline } = layout;
  const countLocal = STAT.countFrom + (local - STAT.countFrom) * countSpeed(env.duration);
  const shown = layout.counts ? countUp(cue.value, countLocal, STAT.countFrom, { decimals: layout.decimals }) : parts.number;
  withMotion(SAFE.left, bandTop(cue.y, layout.height), env, () => {
    brandCard(0, 0, layout.width, layout.height, { tone: "ink", edge: BRAND.lineStrong });
    if (cue.label) kicker(cue.label, CARD_PAD, HEAD_KICKER, local, 0.1, { color: BRAND.steelOnInk, size: STAT.labelFont.size });
    drawStill(() => {
      if (parts.prefix) drawText(parts.prefix, CARD_PAD, numberBaseline, numberInk);
      drawText(shown, numberRight, numberBaseline, { ...numberInk, align: "right" });
      if (cue.sub)
        riseText(cue.sub, CARD_PAD, layout.subBaseline, layout.subFont, riseIn(local, cue.subAt ?? STAT.subAt, { distance: 14, scaleFrom: 1 }), {
          color: BRAND.mutedOnInk,
        });
    });
    const pop = springAt(local - STAT.suffixAt, SPRING.snappy);
    if (parts.suffix && pop > 0)
      drawScaled(numberRight + 10, numberBaseline, lerp(0.5, 1, pop), () => drawText(parts.suffix, 0, 0, { ...suffixInk, alpha: riseAlpha(pop) }));
  });
};
SFX_OF.statTile = (cue, duration) => {
  if (!statLayout(cue).counts) return cardSfx(duration);
  return cardSfx(duration, [{ at: STAT.countFrom, sound: "count", dur: COUNTER_SETTLE / countSpeed(duration) }]);
};

// Funnel: stacked bands narrowing downward, each rising in on its word; the last band is the gold one.
const FUNNEL = { gap: 10, minWidth: 260, labelFont: { ...TYPE.kicker, size: 36 } };
const funnelAt = (tier, index) => itemAt(tier, index, 1 / 3, 0.4);
const tierValue = (value) => (typeof value === "number" ? formatCount(value) : String(value));

function funnelLayout(cue) {
  const head = headLayout(null, cue.text);
  const count = cue.tiers.length;
  const tierHeight = count > 4 ? 64 : 76;
  const valueFont = { ...TYPE.display, size: Math.round(tierHeight * 0.58) };
  const textWidths = cue.tiers.map(
    (tier) => textWidth(tierValue(tier.value), valueFont) + 16 + trackedWidth(tier.label.toUpperCase(), FUNNEL.labelFont, FUNNEL.labelFont.trackingEm),
  );
  // Narrowest bottom width at which every band's text still fits its (narrower) bottom edge.
  const needed = textWidths.map((width, index) => {
    const share = (index + 1) / count;
    return (width + 60 - CARD_INNER * (1 - share)) / share;
  });
  const minWidth = clamp(Math.max(FUNNEL.minWidth, ...needed), FUNNEL.minWidth, CARD_INNER);
  const bodyTop = head.bottom + 26;
  const height = bodyTop + count * tierHeight + (count - 1) * FUNNEL.gap + 40;
  return { head, count, tierHeight, valueFont, textWidths, minWidth, bodyTop, height };
}

COMPONENTS.funnel = (cue, env) => {
  const { local } = env;
  const layout = funnelLayout(cue);
  const { count, tierHeight, valueFont, bodyTop } = layout;
  const widthAt = (share) => lerp(CARD_INNER, layout.minWidth, share);
  const middleX = PANEL_W / 2;
  panelCard(env, cue.y, layout.height, () => {
    drawHead(null, cue.text, local, layout.head);
    cue.tiers.forEach((tier, index) => {
      const rise = riseIn(local, funnelAt(tier, index), { distance: 16, scaleFrom: 1 });
      if (rise.alpha <= 0) return;
      const isLast = index === count - 1;
      const top = bodyTop + index * (tierHeight + FUNNEL.gap) + rise.dy;
      const [topHalf, bottomHalf] = [widthAt(index / count) / 2, widthAt((index + 1) / count) / 2];
      const band = [
        [middleX - topHalf, top],
        [middleX + topHalf, top],
        [middleX + bottomHalf, top + tierHeight],
        [middleX - bottomHalf, top + tierHeight],
      ];
      const textColor = isLast ? BRAND.ink : BRAND.muted;
      const textLeft = middleX - layout.textWidths[index] / 2;
      const baseline = top + tierHeight / 2 + valueFont.size * 0.34;
      const value = tierValue(tier.value);
      ctx.save();
      ctx.globalAlpha *= rise.alpha;
      drawStill(() => {
        wobblyFill(band, isLast ? BRAND.gold : BRAND.white);
        sketchPolygon(band, { color: isLast ? BRAND.goldInk : BRAND.lineStrong, width: 2.5, rough: 0.8, overshoot: 0 });
        drawText(value, textLeft, baseline, { ...valueFont, color: BRAND.ink, wobble: 0 });
        const labelX = textLeft + textWidth(value, valueFont) + 16;
        trackedText(tier.label.toUpperCase(), labelX, baseline - 2, FUNNEL.labelFont, FUNNEL.labelFont.trackingEm, { color: textColor, wobble: 0 });
      });
      ctx.restore();
    });
  });
};
SFX_OF.funnel = (cue, duration) =>
  cardSfx(
    duration,
    cue.tiers.map((tier, index) => ({
      at: funnelAt(tier, index) + 0.05,
      sound: index === cue.tiers.length - 1 ? "nodeGold" : "tick",
      pan: tickPan(index),
    })),
  );
