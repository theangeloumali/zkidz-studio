// Created by The Angelo Umali.
// Charts: the series progress map and the contributions-per-year bars.

// Series overview: the finished series ticked, the new one as a row of circuit-node episodes.
const SERIES_CHECK = [0.3, 0.55];

COMPONENTS.seriesMap = (cue, env) => {
  const { local } = env;
  const titleFont = { ...TYPE.display, size: 56 };
  panelCard(
    env,
    cardTop(cue),
    380,
    () => {
      kicker(cue.text, 50, 72, local, 0.1);
      drawCheck(80, 150, 46, { progress: span(local, ...SERIES_CHECK), color: BRAND.steel });
      wordsRise(cue.done, 130, 168, titleFont, local, 0.25);
      drawText("posted", 700, 166, { ...TYPE.hand, size: 50, wobble: 0.6, reveal: span(local, ...penSpan("posted", 0.5)) });
      wordsRise(cue.next, 60, 262, titleFont, local, 0.6);
      for (let i = 0; i < cue.episodes; i++) {
        const pop = springAt(local - (0.9 + i * 0.08), SPRING.snappy);
        ctx.save();
        if (pop <= 0) ctx.globalAlpha *= 0.3;
        nodeRing(80 + i * 57, 330, 20, { color: pop > 0 ? BRAND.steel : BRAND.muted, pop: pop > 0 ? pop : 1, surface: BRAND.paper });
        ctx.restore();
      }
    },
    cardAccent(local),
  );
};

SFX_OF.seriesMap = (cue, duration) => cardSfx(duration, [{ at: SERIES_CHECK[1], sound: "check" }]);

// Contributions per year: bars from `reveal` on, the focus year grows and counts up, colour marks the era.
// The eras keep teal / gold / accent.
const ERA = [
  { until: 2023, color: C.teal, label: "no AI" },
  { until: 2024, color: C.gold, label: "AI-assisted" },
  { until: 9999, color: C.accent, label: "AI-native" },
];
const eraOf = (year) => ERA.find((era) => year <= era.until);
const CHART_FOCUS_AT = 0.2;
const yearLabel = (year) => `'${String(year).slice(2)}`;

COMPONENTS.contribChart = (cue, env) => {
  const { local } = env;
  const height = 440;
  const chartLeft = 60;
  const chartBottom = 350;
  const slot = (PANEL_W - chartLeft - 30) / cue.years.length;
  const barW = slot * 0.62;
  const maxCount = Math.max(...cue.years.map(([, count]) => count));
  const barHeight = (count) => Math.max(3, (count / maxCount) * 175);
  // Axis, count and legend text stay >= 30 px so they read on a phone.
  const yearFont = { ...TYPE.mono, size: 34 };
  const titleFont = { ...TYPE.display, size: 50 };
  titleFont.size = fitFontSize(cue.title, titleFont, PANEL_W - 320);
  panelCard(
    env,
    cue.y ?? SAFE.top + 10,
    height,
    () => {
      if (cue.kicker) kicker(cue.kicker, 40, 58, local, 0.1);
      wordsRise(cue.title, 40, 112, titleFont, local, 0.2);
      ERA.forEach((era, index) => {
        const x = PANEL_W - 270;
        const y = 46 + index * 38;
        drawStill(() => sketchRect(x, y - 20, 24, 24, { fill: era.color, color: BRAND.lineStrong, width: 2, passes: 1, overshoot: 0 }));
        drawText(era.label, x + 36, y + 2, { ...TYPE.label, size: 30, wobble: 0.2 });
      });
      drawStill(() => sketchLine(chartLeft - 10, chartBottom, PANEL_W - 20, chartBottom, { width: 4, color: BRAND.lineStrong, passes: 1, overshoot: 0 }));
      cue.years.forEach(([year, count], index) => {
        const x = chartLeft + index * slot + (slot - barW) / 2;
        const isFocus = year === cue.focus;
        if (year < cue.reveal) {
          drawText(yearLabel(year), x + barW / 2, chartBottom + 38, { ...yearFont, color: BRAND.muted, alpha: 0.55, align: "center", wobble: 0.2 });
          return;
        }
        const h = barHeight(count) * (isFocus ? springAt(local - CHART_FOCUS_AT) : 1);
        const bar = () =>
          sketchRect(x, chartBottom - h, barW, h, { fill: eraOf(year).color, color: BRAND.ink, width: isFocus ? 4 : 2.5, passes: 1, rough: 1.2 });
        // The focus bar grows, so only settled bars are still furniture.
        if (h > 0) stillInk(isFocus ? null : drawingCueSeed, bar);
        drawText(yearLabel(year), x + barW / 2, chartBottom + 38, { ...yearFont, weight: isFocus ? 700 : 500, align: "center", wobble: 0.2 });
        if (!isFocus)
          drawText(formatCount(count), x + barW / 2, chartBottom - h - 10, { ...TYPE.mono, size: 30, color: BRAND.muted, align: "center", wobble: 0.2 });
      });
      if (cue.focus) {
        const [, count] = cue.years.find(([year]) => year === cue.focus);
        // Top-left is always clear (pre-2020 bars are tiny), so the focus number never covers a bar.
        const labelFont = { ...TYPE.display, size: 64 };
        drawText(countUp(count, local, CHART_FOCUS_AT), 40, 210, { ...labelFont, wobble: 0.2 });
        drawText(`in ${cue.focus}`, 56 + textWidth(formatCount(count), labelFont), 208, { ...TYPE.hand, size: 46, wobble: 0.6 });
      }
      if (cue.note)
        drawText(cue.note, 40, height - 18, { ...TYPE.hand, size: 40, maxWidth: PANEL_W - 80, wobble: 0.6, reveal: span(local, ...penSpan(cue.note, 0.8)) });
    },
    cardAccent(local),
  );
};

SFX_OF.contribChart = (cue, duration) => cardSfx(duration, cue.focus ? [countSfx(CHART_FOCUS_AT, duration)] : []);
