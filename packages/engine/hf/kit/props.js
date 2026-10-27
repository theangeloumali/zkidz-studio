// Created by The Angelo Umali.
// Reusable doodle props: bursts, arrows, motion marks and scene objects.

function drawBurst(centerX, centerY, innerRadius, outerRadius, count, options = {}) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (options.spin || 0);
    sketchLine(
      centerX + Math.cos(angle) * innerRadius,
      centerY + Math.sin(angle) * innerRadius,
      centerX + Math.cos(angle) * outerRadius,
      centerY + Math.sin(angle) * outerRadius,
      { color: options.color || C.ink, width: options.width || 5, passes: 1 },
    );
  }
}

function drawArrow(fromX, fromY, toX, toY, options = {}) {
  const bend = options.bend ?? 0.25;
  const midX = (fromX + toX) / 2 - (toY - fromY) * bend;
  const midY = (fromY + toY) / 2 + (toX - fromX) * bend;
  const points = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    points.push([(1 - t) ** 2 * fromX + 2 * (1 - t) * t * midX + t * t * toX, (1 - t) ** 2 * fromY + 2 * (1 - t) * t * midY + t * t * toY]);
  }
  const drawn = slicePath(points, options.progress ?? 1);
  sketchPath(drawn, options);
  if ((options.progress ?? 1) < 1) return;
  const angle = Math.atan2(toY - points[10][1], toX - points[10][0]);
  const head = options.head || 26;
  [-0.5, 0.5].forEach((offset) =>
    sketchLine(toX, toY, toX - Math.cos(angle + offset) * head, toY - Math.sin(angle + offset) * head, { ...options, passes: 1 }),
  );
}

// Horizontal streaks that loop across the frame; `travel` is pixels moved so far.
function drawSpeedLines(travel, options = {}) {
  const rand = mulberry32(options.seed || 3);
  for (let i = 0; i < (options.count || 14); i++) {
    const lineY = (options.top ?? 0) + rand() * (options.height ?? H);
    const length = 120 + rand() * 260;
    const lineX = W + 400 - ((rand() * (W + 800) + travel * (0.7 + rand() * 0.6)) % (W + 800));
    sketchLine(lineX, lineY, lineX + length, lineY, { color: options.color || C.lightGray, width: 4, passes: 1, rough: 1 });
  }
}

function drawDust(centerX, centerY, progress, scale = 1) {
  if (progress <= 0 || progress >= 1) return;
  [-1, 1].forEach((side) => {
    for (let i = 0; i < 3; i++) {
      const radius = (10 + i * 7) * scale * (0.4 + progress);
      sketchEllipse(centerX + side * (60 + i * 40) * scale * ease.out(progress), centerY - i * 10 * scale, radius, radius * 0.8, {
        color: C.gray,
        width: 3,
        alpha: 1 - progress,
        passes: 1,
      });
    }
  });
}

// A runaway strip of code: rows of coloured squiggles scrolling left by `scroll` px.
function drawCodeStrip(x, y, w, h, scroll) {
  sketchRect(x, y, w, h, { fill: C.white, color: C.ink, width: 5 });
  const palette = [C.ink, C.accent, C.sky, C.olive, C.gray];
  const rows = 5;
  const period = 900;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 6, y + 6, w - 12, h - 12);
  ctx.clip();
  for (let row = 0; row < rows; row++) {
    const rowY = y + (h / (rows + 1)) * (row + 1);
    const rand = mulberry32(row * 97 + 11);
    const segments = [];
    let cursor = 0;
    while (cursor < period) {
      const length = 40 + rand() * 140;
      segments.push([cursor, length, palette[Math.floor(rand() * palette.length)]]);
      cursor += length + 24;
    }
    const shift = scroll % period;
    for (let copy = 0; copy * period < w + period; copy++) {
      segments.forEach(([start, length, color]) => {
        const segmentX = x + 30 + start + copy * period - shift + (row % 2) * 40;
        if (segmentX > x + w || segmentX + length < x) return;
        sketchLine(segmentX, rowY, segmentX + length, rowY, { color, width: 9, passes: 1, rough: 1.2, overshoot: 0 });
      });
    }
  }
  ctx.restore();
}

function drawClock(centerX, centerY, radius, minuteAngle, hourAngle) {
  sketchEllipse(centerX, centerY, radius, radius, { fill: C.white, width: 7 });
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const inner = i % 3 === 0 ? 0.8 : 0.87;
    sketchLine(
      centerX + Math.cos(angle) * radius * inner,
      centerY + Math.sin(angle) * radius * inner,
      centerX + Math.cos(angle) * radius * 0.94,
      centerY + Math.sin(angle) * radius * 0.94,
      { width: i % 3 === 0 ? 8 : 4, passes: 1 },
    );
  }
  const hand = (angle, length, width, color) => {
    const tipX = centerX + Math.cos(angle - Math.PI / 2) * length;
    const tipY = centerY + Math.sin(angle - Math.PI / 2) * length;
    sketchLine(centerX, centerY, tipX, tipY, { width, color, passes: 1 });
    return [tipX, tipY];
  };
  hand(hourAngle, radius * 0.45, 14, C.ink);
  const tip = hand(minuteAngle, radius * 0.72, 9, C.accent);
  sketchEllipse(centerX, centerY, 14, 14, { fill: C.ink, stroke: false });
  return tip;
}

function drawSpreadsheet(x, y, w, h) {
  const cols = 5;
  const rows = 6;
  sketchRect(x, y, w, h, { fill: C.white, width: 5 });
  sketchRect(x, y, w, h / rows, { stroke: false, hatch: { color: C.accent, gap: 12, width: 3 } });
  for (let col = 1; col < cols; col++) sketchLine(x + (w / cols) * col, y, x + (w / cols) * col, y + h, { width: 2.5, passes: 1 });
  for (let row = 1; row < rows; row++) sketchLine(x, y + (h / rows) * row, x + w, y + (h / rows) * row, { width: 2.5, passes: 1 });
  const rand = mulberry32(42);
  for (let row = 1; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellX = x + (w / cols) * col + 14;
      const cellY = y + (h / rows) * (row + 0.5);
      sketchLine(cellX, cellY, cellX + (w / cols - 28) * (0.4 + rand() * 0.6), cellY, {
        color: col === cols - 1 ? C.olive : C.gray,
        width: 5,
        passes: 1,
        overshoot: 0,
      });
    }
  }
}

function drawExamPaper(x, y, w, h) {
  sketchRect(x, y, w, h, { fill: C.white, width: 5 });
  const rand = mulberry32(7);
  for (let row = 0; row < 6; row++) {
    const lineY = y + 70 + row * ((h - 110) / 6);
    sketchLine(x + 80, lineY, x + 80 + (w - 180) * (0.5 + rand() * 0.5), lineY, { color: C.gray, width: 5, passes: 1 });
    sketchPath(
      [
        [x + 30, lineY - 6],
        [x + 42, lineY + 6],
        [x + 62, lineY - 18],
      ],
      { color: C.olive, width: 6, passes: 1 },
    );
  }
}

function drawTrophy(centerX, bottomY, scale) {
  const cup = [
    [centerX - 110 * scale, bottomY - 330 * scale],
    [centerX + 110 * scale, bottomY - 330 * scale],
    [centerX + 80 * scale, bottomY - 170 * scale],
    [centerX + 20 * scale, bottomY - 130 * scale],
    [centerX - 20 * scale, bottomY - 130 * scale],
    [centerX - 80 * scale, bottomY - 170 * scale],
  ];
  [-1, 1].forEach((side) => sketchEllipse(centerX + side * 112 * scale, bottomY - 270 * scale, 34 * scale, 44 * scale, { width: 7, passes: 1 }));
  wobblyFill(cup, C.gold);
  sketchPolygon(cup, { width: 6 });
  sketchRect(centerX - 18 * scale, bottomY - 130 * scale, 36 * scale, 70 * scale, { fill: C.gold, width: 5 });
  sketchRect(centerX - 90 * scale, bottomY - 60 * scale, 180 * scale, 60 * scale, { fill: C.ink, width: 5 });
}

// Pencil rocket pointing along `angle`, nose at +x.
function drawRocket(x, y, angle, scale, flicker) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const flame = [
    [-150 * scale, -28 * scale],
    [(-260 - flicker * 70) * scale, 0],
    [-150 * scale, 28 * scale],
  ];
  wobblyFill(flame, C.gold);
  wobblyFill(
    [
      [-150 * scale, -16 * scale],
      [(-215 - flicker * 40) * scale, 0],
      [-150 * scale, 16 * scale],
    ],
    C.accent,
  );
  const body = [
    [-150 * scale, -45 * scale],
    [90 * scale, -45 * scale],
    [190 * scale, 0],
    [90 * scale, 45 * scale],
    [-150 * scale, 45 * scale],
  ];
  wobblyFill(body, C.white);
  sketchPolygon(body, { width: 6 });
  wobblyFill(
    [
      [-150 * scale, 45 * scale],
      [-190 * scale, 95 * scale],
      [-90 * scale, 45 * scale],
    ],
    C.accent,
  );
  sketchEllipse(60 * scale, 0, 22 * scale, 22 * scale, { fill: C.sky, width: 5, passes: 1 });
  sketchLine(90 * scale, -45 * scale, 90 * scale, 45 * scale, { width: 4, passes: 1 });
  ctx.restore();
}

function drawCoin(x, y, radius, spin) {
  const squeeze = Math.max(0.12, Math.abs(Math.cos(spin)));
  sketchEllipse(x, y, radius * squeeze, radius, { fill: C.gold, width: 4, passes: 1 });
  if (squeeze > 0.5) drawText("$", x, y + radius * 0.35, { family: FONT.serif, weight: 700, size: radius * 1.1, align: "center", color: C.ink, wobble: 0.5 });
}

function drawSpeechBubble(x, y, w, h, tailX, tailY) {
  const tailLeft = [x + w * 0.22, y + h * 0.8];
  const tailRight = [x + w * 0.42, y + h * 0.95];
  wobblyFill([tailLeft, [tailX, tailY], tailRight], C.white);
  sketchLine(tailLeft[0], tailLeft[1], tailX, tailY, { width: 5, passes: 1, overshoot: 0 });
  sketchLine(tailRight[0], tailRight[1], tailX, tailY, { width: 5, passes: 1, overshoot: 0 });
  sketchEllipse(x + w / 2, y + h / 2, w / 2, h / 2, { fill: C.white, width: 5 });
  wobblyFill(
    [tailLeft, [lerp(tailLeft[0], tailX, 0.3), lerp(tailLeft[1], tailY, 0.3)], [lerp(tailRight[0], tailX, 0.3), lerp(tailRight[1], tailY, 0.3)], tailRight],
    C.white,
  );
}

// Hand-drawn tick sized to `size` px, centred on (x, y); `progress` draws it on.
function drawCheck(x, y, size, options = {}) {
  const tick = [
    [x - size * 0.45, y],
    [x - size * 0.12, y + size * 0.35],
    [x + size * 0.5, y - size * 0.5],
  ];
  sketchPath(slicePath(tick, options.progress ?? 1), { color: options.color || C.olive, width: options.width || size * 0.2, passes: 1 });
}

// Shield silhouette (seal, guard scenes).
function shieldOutline(centerX, top, width, height) {
  return [
    [centerX - width / 2, top],
    [centerX + width / 2, top],
    [centerX + width * 0.46, top + height * 0.55],
    [centerX, top + height],
    [centerX - width * 0.46, top + height * 0.55],
  ];
}
