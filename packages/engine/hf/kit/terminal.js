// Created by The Angelo Umali.
// A drawn terminal that replays recorded lines like a real one: input is typed, output lands whole.
// lines: [{ kind: "input" | "warn" | "block" | "pass" | "output", text }]; progress 0..1 plays them in order.
const TERMINAL_STYLE = {
  input: { color: "#9C9A92", prefix: "› ", isTyped: true },
  warn: { color: "#E3B341", prefix: "" },
  block: { color: "#E07A5F", prefix: "" },
  pass: { color: "#8FB573", prefix: "" },
  output: { color: "#D8D6CE", prefix: "" }, // plain script output, not a verdict
};
// Default look; a film can pass its own palette (e.g. a light "spec sheet" terminal).
const TERMINAL_DARK = { background: "#141413", edge: Z.ink, bar: "#26251F", muted: "#9C9A92", colors: {} };
// Light "spec sheet" terminal in a given ink, with `accent` for warnings.
const terminalLight = (ink, accent, { bar = "#E6E2D8", muted = "#7C7A72" } = {}) => ({
  background: "#FBFAF6",
  edge: ink,
  bar,
  muted,
  colors: { input: muted, warn: accent, block: C.accentDark, pass: C.olive, output: ink },
});
const TERMINAL_FONT_SIZE = 25;
const TERMINAL_LINE_HEIGHT = 36;
const OUTPUT_PAUSE_UNITS = 14; // an output block costs about as long as typing 14 characters

// Wraps on spaces; keeps a line's leading indent and gives a blank line its own empty row, as a terminal would.
function wrapMonospace(text, columns) {
  const indent = text.match(/^ */)[0];
  if (indent.length === text.length) return [""];
  const rows = [];
  let row = indent;
  text
    .slice(indent.length)
    .split(" ")
    .forEach((word) => {
      while (word.length > columns) {
        if (row) rows.push(row);
        rows.push(word.slice(0, columns));
        word = word.slice(columns);
        row = "";
      }
      const candidate = row.trim() ? `${row} ${word}` : row + word;
      if (candidate.length > columns) {
        rows.push(row);
        row = word;
      } else row = candidate;
    });
  if (row) rows.push(row);
  return rows;
}

// Each line costs "units": typed input costs one per character, an output line a fixed pause.
// Wrapping is fixed for a given lines array and width, so it's cached rather than redone every frame.
const wrappedLines = new WeakMap();
function terminalBlocks(lines, columns, palette, colorOf) {
  const cached = wrappedLines.get(lines);
  if (cached?.columns === columns && cached.palette === palette) return cached;
  const blocks = lines.map((line) => {
    const style = TERMINAL_STYLE[line.kind];
    const rows = wrapMonospace(style.prefix + line.text, columns).map((text) => ({ text, color: colorOf(line.kind) }));
    const cost = style.isTyped ? rows.reduce((sum, row) => sum + row.text.length, 0) : OUTPUT_PAUSE_UNITS;
    return { rows, cost, isTyped: style.isTyped };
  });
  const wrapped = { columns, palette, blocks, totalUnits: blocks.reduce((sum, block) => sum + block.cost, 0) };
  wrappedLines.set(lines, wrapped);
  return wrapped;
}

function drawTerminal({ x, y, w, h, title, lines, progress, palette = TERMINAL_DARK }) {
  const colorOf = (kind) => palette.colors[kind] ?? TERMINAL_STYLE[kind].color;
  const font = { family: FONT.mono, size: TERMINAL_FONT_SIZE, weight: 500 };
  const charWidth = textWidth("M", font);
  const columns = Math.floor((w - 56) / charWidth);
  sketchRect(x, y, w, h, { fill: palette.background, color: palette.edge, width: 5, passes: 1 });
  sketchRect(x, y, w, 48, { stroke: false, fill: palette.bar });
  [colorOf("block"), colorOf("warn"), colorOf("pass")].forEach((dot, index) => sketchEllipse(x + 28 + index * 24, y + 24, 7, 7, { fill: dot, stroke: false }));
  drawText(title, x + w / 2, y + 32, { family: FONT.mono, size: 18, color: palette.muted, align: "center", wobble: 0.2 });

  const { blocks, totalUnits } = terminalBlocks(lines, columns, palette, colorOf);
  let unitsLeft = totalUnits * clamp(progress);
  const visible = [];
  for (const block of blocks) {
    if (unitsLeft <= 0) break;
    if (!block.isTyped) {
      if (unitsLeft >= block.cost) visible.push(...block.rows);
      unitsLeft -= block.cost;
      continue;
    }
    let charsLeft = Math.floor(unitsLeft);
    for (const row of block.rows) {
      if (charsLeft <= 0) break;
      visible.push({ ...row, text: row.text.slice(0, charsLeft) });
      charsLeft -= row.text.length;
    }
    unitsLeft -= block.cost;
  }
  const capacity = Math.floor((h - 90) / TERMINAL_LINE_HEIGHT);
  const shown = visible.slice(Math.max(0, visible.length - capacity));
  shown.forEach((row, index) => drawText(row.text, x + 28, y + 92 + index * TERMINAL_LINE_HEIGHT, { ...font, color: row.color, wobble: 0.15 }));
  const isCursorOn = progress < 1 || boilStep % 4 < 2; // solid while typing, blinks once idle
  if (isCursorOn) {
    const lastRow = shown[shown.length - 1] || { text: "" };
    const cursorX = x + 28 + lastRow.text.length * charWidth + 4;
    const cursorY = y + 92 + Math.max(0, shown.length - 1) * TERMINAL_LINE_HEIGHT;
    sketchRect(cursorX, cursorY - TERMINAL_FONT_SIZE + 4, charWidth * 0.8, TERMINAL_FONT_SIZE, { stroke: false, fill: palette.muted });
  }
}
