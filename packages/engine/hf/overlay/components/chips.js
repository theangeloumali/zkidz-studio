// Created by The Angelo Umali.
// Skill chips, code fix, typed terminal and the devices row.

// Chips flow left to right and wrap inside the safe zone (narrower beside the button column).
function chipSlots(cue, top) {
  const rowHeight = CHIP_HEIGHT + 28;
  let x = SAFE.left;
  let y = top;
  return cue.items.map((item) => {
    const width = chipWidth(item.text);
    if (x > SAFE.left && x + width > safeRight(y + CHIP_HEIGHT)) {
      x = SAFE.left;
      y += rowHeight;
    }
    const slot = { x, y, width };
    x += width + 22;
    return slot;
  });
}

// Hand-lettered swashes (the "j" of "job-board") overhang their origin; this shifts the ink back inside the margin.
function inkOverhang(text, font) {
  ctx.save();
  applyFont(font);
  const overhang = ctx.measureText(text).actualBoundingBoxLeft;
  ctx.restore();
  return Math.max(0, overhang);
}

// Mono brand chips (spec §2.5): `hot` is the ink chip with goldBright text, `tag` a gold-ringed badge, `note` a
// handwritten aside under the chip, `at` pins an item's entry.
// The hand label's place and font (when the cue has text) and the chips' slots (page space).
function chipsLayout(cue) {
  const top = (cue.y ?? SAFE.top + 30) + (cue.text ? 90 : 0);
  const font = { ...TYPE.hand, size: 70 };
  return { label: cue.text && { x: SAFE.left + inkOverhang(cue.text, font), y: top - 36, font }, slots: chipSlots(cue, top) };
}

// A chip at its own centre: the mono chip and, if tagged, its gold-ringed badge on the top-right corner.
function drawChipItem(item, width) {
  drawChip(-width / 2, -CHIP_HEIGHT / 2, item.text, item.hot ? HOT_CHIP : {});
  if (item.tag) ringBadge(width / 2 - 4, -CHIP_HEIGHT / 2 - 2, 24, item.tag);
}

// A note writes on under its chip's slot, `write` seconds after the chip's start.
const CHIP_NOTE = { dx: 10, dy: 118, size: 50, write: [0.35, 0.9] };

COMPONENTS.chips = (cue, env) => {
  const { local } = env;
  const { label, slots } = chipsLayout(cue);
  const footageAlpha = exitAlpha(env);
  if (label) {
    ctx.save();
    ctx.globalAlpha *= footageAlpha;
    strokedText(cue.text, label.x, label.y, label.font, {
      fill: cue.color ?? BRAND.paper,
      reveal: span(local, ...penSpan(cue.text, 0)),
    });
    ctx.restore();
  }
  slots.forEach(({ x, y, width }, index) => {
    const item = cue.items[index];
    const start = chipStartOf(cue, index);
    withMotion(x + width / 2, y + CHIP_HEIGHT / 2, env, () => drawChipItem(item, width), { start, preset: SPRING.snappy, scaleFrom: 0.85, distance: 16 });
    if (item.note) {
      ctx.save();
      ctx.globalAlpha *= footageAlpha;
      const [from, to] = CHIP_NOTE.write;
      strokedText(
        item.note,
        x + CHIP_NOTE.dx,
        y + CHIP_NOTE.dy,
        { ...TYPE.hand, size: CHIP_NOTE.size },
        {
          fill: BRAND.goldBright,
          reveal: span(local, start + from, start + to),
        },
      );
      ctx.restore();
    }
  });
};

SFX_OF.chips = (cue) => cue.items.map((item, index) => ({ at: chipStartOf(cue, index) + 0.05, sound: "tick", pan: tickPan(index) }));

// A bad identifier crossed and struck out, then the descriptive one typed in and checked, on an ink card.
// Bad keeps the kit terminal's block red (5.44:1 on ink); good is the brand terminal's pass steel.
const CODE_FIX = { cross: [0.4, 0.7], strike: [0.5, 0.9], typeAt: 0.9, cps: 30 };
const codeFixCheckAt = (cue) => CODE_FIX.typeAt + cue.good.length / CODE_FIX.cps + 0.1;

COMPONENTS.codeFix = (cue, env) => {
  const { local } = env;
  const bad = TERMINAL_STYLE.block.color;
  const good = TERMINAL_BRAND.colors.pass;
  const badFont = { ...TYPE.mono, size: 44 };
  badFont.size = fitFontSize(cue.bad, badFont, 800);
  const goodFont = { ...TYPE.mono, size: 44 };
  goodFont.size = fitFontSize(`${cue.good}_`, goodFont, 800);
  const checkAt = codeFixCheckAt(cue);
  panelCard(
    env,
    cue.y ?? SAFE.top + 30,
    300,
    () => {
      drawText(cue.bad, 110, 110, { ...badFont, color: bad, wobble: 0.2 });
      drawCross(60, 96, 40, { progress: span(local, ...CODE_FIX.cross), color: bad });
      const strike = span(local, ...CODE_FIX.strike);
      if (strike > 0) sketchLine(104, 96, 104 + textWidth(cue.bad, badFont) * strike, 100, { color: bad, width: 6, passes: 1 });
      drawText(typeOn(cue.good, local, CODE_FIX.typeAt, { cps: CODE_FIX.cps }), 110, 230, { ...goodFont, color: good, wobble: 0.2 });
      drawCheck(60, 214, 50, { progress: span(local, checkAt, checkAt + 0.3), color: good });
    },
    { tone: "ink", ...cardAccent(local) },
  );
};

SFX_OF.codeFix = (cue, duration) =>
  cardSfx(duration, [
    { at: CODE_FIX.strike[0], sound: "scratch", dur: CODE_FIX.strike[1] - CODE_FIX.strike[0] },
    { at: CODE_FIX.typeAt, sound: "type", dur: cue.good.length / CODE_FIX.cps },
    { at: codeFixCheckAt(cue) + 0.3, sound: "check" },
  ]);

// Kit terminal in the brand palette, scaled up for phone legibility; `lines` type on between typeFrom and typeTo.
// Its chrome is still furniture, so the idle cursor holds instead of blinking.
const terminalTypeSpan = (cue) => [cue.typeFrom ?? 0.2, cue.typeTo ?? 1.5];
// On-screen floor for its text. The kit draws lines at TERMINAL_FONT_SIZE and an 18 px title, so the title is redrawn here.
const TERMINAL_MIN_PX = 28;

COMPONENTS.terminalCard = (cue, env) => {
  const scale = Math.max(cue.scale ?? 1.5, TERMINAL_MIN_PX / TERMINAL_FONT_SIZE);
  const titleFont = { family: FONT.mono, size: Math.max(18, TERMINAL_MIN_PX / scale), color: TERMINAL_BRAND.muted, align: "center", wobble: 0.2 };
  const width = cue.w ?? 620;
  const height = cue.h ?? 300;
  withMotion(PW / 2, cardTop(cue), env, () =>
    drawScaled(-(width * scale) / 2, 0, scale, () =>
      drawStill(() => {
        dropShadow(rectPoints(0, 0, width, height));
        drawTerminal({
          x: 0,
          y: 0,
          w: width,
          h: height,
          title: "",
          lines: cue.lines,
          progress: span(env.local, ...terminalTypeSpan(cue)),
          palette: TERMINAL_BRAND,
        });
        if (cue.title) drawText(cue.title, width / 2, 32, titleFont);
      }),
    ),
  );
};

SFX_OF.terminalCard = (cue, duration) => {
  const [typeFrom, typeTo] = terminalTypeSpan(cue);
  return cardSfx(duration, [{ at: typeFrom, sound: "type", dur: typeTo - typeFrom }]);
};

// A row of laptops rising in turn under a handwritten line; a single laptop is centred.
const deviceAt = (index) => staggerAt(index, 0.3, 0.3);
const LAPTOP_W = 190;

COMPONENTS.devices = (cue, env) => {
  const { local } = env;
  const count = cue.items.length;
  const rowLeft = SAFE.left + LAPTOP_LIP;
  const pitch = count > 1 ? (SAFE.right - LAPTOP_LIP - rowLeft - LAPTOP_W) / (count - 1) : 0;
  const top = cue.y ?? SAFE.top + 40;
  if (cue.text) {
    ctx.save();
    ctx.globalAlpha *= exitAlpha(env);
    strokedText(cue.text, PW / 2, top + 20, { ...TYPE.hand, size: 74 }, { align: "center", reveal: span(local, ...penSpan(cue.text, 0)) });
    ctx.restore();
  }
  cue.items.forEach((label, index) => {
    const centreX = count > 1 ? rowLeft + index * pitch + LAPTOP_W / 2 : PW / 2;
    withMotion(centreX, top + 160, env, () => drawLaptop(-LAPTOP_W / 2, -70, LAPTOP_W, label), { start: deviceAt(index) });
  });
};

SFX_OF.devices = (cue) => cue.items.map((label, index) => ({ at: deviceAt(index) + 0.05, sound: "tick", pan: tickPan(index) }));
