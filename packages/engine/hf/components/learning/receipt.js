// Created by The Angelo Umali.
// receipt (s_info.png): "— INPUT" counts up as the clip bars build, bad-take and pause stripes land, then the kept blocks
// pack left as it counts down to the output, landing in the accent. engine/receipt.py writes the cue: every number is the EDL's.
const { unit } = require("../../brand/html");
const { num } = require("../../brand/recorder");
const { advanceWidth } = require("../../brand/fonts");
const { rise, show, hide, fade } = require("../../fx/motion");
const { LEARNING } = require("../../learning/tokens");
const { rectClip, glyph, microLabel, fadeOut, track } = require("./typing");

const { receipt: R, big: BIG } = LEARNING;
const MONO = LEARNING.type.mono;
const TOLERANCE = 0.05; // the EDL rounds to frames

function clock(seconds) {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  return `${minutes}:${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}`;
}

const sum = (items, of) => items.reduce((total, item) => total + of(item), 0);
const merged = (parts) => ({ html: parts.map((part) => part.html).join(""), motion: parts.flatMap((part) => part.motion) });
const barRect = (left, width, fill, extra = "") =>
  `<rect x="${num(left)}" y="${R.barY}" width="${num(width)}" height="${R.barHeight}"${extra} fill="${fill}"/>`;
const fadeAway = (target, at) => fade(target, at, { from: 1, to: 0, duration: 0.15, ease: "power2.in", later: true });

function checked(cue) {
  const [input, output] = [cue.input.seconds, cue.output];
  const removed = [...cue.removed].sort((a, b) => a.start - b.start);
  const cut = sum(removed, (item) => item.end - item.start);
  const clips = sum(cue.input.clips, (clip) => clip.seconds);
  const overlapping = removed.some((item, index) => item.start < (removed[index - 1]?.end ?? 0) || item.end > input + TOLERANCE || item.end < item.start);
  if (overlapping || Math.abs(clips - input) > TOLERANCE || Math.abs(input - cut - output) > TOLERANCE) {
    throw new Error(`receipt numbers do not add up: clips ${clock(clips)}, input ${clock(input)} - removed ${clock(cut)} vs output ${clock(output)}`);
  }
  return { input, output, removed };
}

function receiptLayout(cue, duration) {
  const { input, output, removed } = checked(cue);
  const countAt = cue.countAt ?? 0.15;
  const up = Math.max(0.3, Math.min(R.up, (cue.badAt ?? Infinity) - countAt));
  const badAt = cue.badAt ?? countAt + up + 0.3;
  const pausesAt = cue.pausesAt ?? badAt + 0.5;
  const collapseAt = cue.collapseAt ?? pausesAt + 0.8;
  const [landing, end] = [collapseAt + R.down, duration - LEARNING.exit];
  if (landing > end + 1e-9) throw new Error(`receipt: collapseAt ${collapseAt} lands at ${num(landing)}, past its exit at ${num(end)}`);
  const [x, w] = [cue.x ?? R.x, cue.w ?? R.w];
  const px = (seconds) => x + (seconds / input) * w;
  const kept = [...removed, { start: input, end: input }].flatMap((item, index, all) => {
    const from = index ? all[index - 1].end : 0;
    return item.start > from ? [{ start: from, end: item.start }] : [];
  });
  const [bad, pauses] = [removed.filter((item) => item.why === "bad"), removed.filter((item) => item.why !== "bad")];
  const moves = Math.abs(input - output) > TOLERANCE;
  return { input, output, countAt, up, badAt, pausesAt, collapseAt, landing, x, w, px, kept, bad, pauses, moves };
}

// The counter as a strip of values clipped to one row; one stepped track walks it up, then down to the accent final.
function counter(layout) {
  const { input, output, countAt, up, collapseAt, landing, x, moves } = layout;
  const font = { ...LEARNING.type.display, size: R.counterSize };
  const ease = (progress) => 1 - (1 - progress) ** 2;
  const steps = Array.from({ length: R.steps }, (_, index) => index + 1);
  const final = clock(output);
  const roll = (from, to, at, seconds) => (step) => ({ label: clock(from + (to - from) * ease(step / R.steps)), at: at + (step * seconds) / R.steps });
  // The down roll never shows the final early: that row is the accent one.
  const down = moves
    ? steps
        .slice(0, -1)
        .map(roll(input, output, collapseAt, R.down))
        .filter((row) => row.label !== final)
    : [];
  const rows = [{ label: clock(0), at: 0 }, ...steps.map(roll(0, input, countAt, up)), ...down];
  const strip = rows.filter((row, index) => row.label !== rows[index - 1]?.label);
  strip.push({ label: final, at: landing, colour: LEARNING.accentInk });
  const line = 1.2 * font.size;
  const svg = strip.map((row, index) => glyph(row.label, x, R.counterY + index * line, font, row.colour ?? LEARNING.ink)).join("");
  const [top, bottom] = [R.counterY - (BIG.ascent + 0.1) * font.size, R.counterY + (BIG.descent + 0.1) * font.size];
  const clip = rectClip(x - 20, top, 1080, bottom);
  const walk = strip.slice(1).map((row, index) => [row.at, { y: -(index + 1) * line }]);
  return {
    html: `<div class="u rc-counter" style="clip-path:${clip}">${unit("rc-strip", svg)}</div>`,
    motion: [track(".rc-strip", 0, { y: 0 }, walk)],
  };
}

// Clip bars building as the count runs, their mono labels flowed left to right under them.
function clipBars(cue, layout) {
  const { input, countAt, up, collapseAt, px, x, w } = layout;
  const font = { ...MONO, size: R.labelSize };
  const labelY = R.barY + R.barHeight + R.labelGap;
  let [start, labelRight] = [0, -Infinity];
  const bars = cue.input.clips.map((clip, index, clips) => {
    const left = px(start) + (index ? R.clipGap / 2 : 0);
    const right = px(start + clip.seconds) - (index < clips.length - 1 ? R.clipGap / 2 : 0);
    const text = `${clip.label} ${clock(clip.seconds)}`;
    const labelX = Math.max(px(start), labelRight + 16);
    labelRight = labelX + advanceWidth(text, font);
    const at = countAt + (start / input) * up;
    start += clip.seconds;
    return {
      html: unit(`rc-clip${index}`, barRect(left, Math.max(1, right - left), R.clip, ' rx="4"'), [left, R.barY + R.barHeight / 2]),
      label: glyph(text, labelX, labelY, font, LEARNING.ink, ' fill-opacity="0.7"'),
      motion: [
        { target: `.rc-clip${index}`, at, from: { scaleX: 0 }, to: { scaleX: 1, duration: Math.max(0.05, (clip.seconds / input) * up), ease: "power2.out" } },
        fadeAway(`.rc-clip${index}`, collapseAt),
      ],
    };
  });
  if (labelRight > x + w + 1) throw new Error(`receipt clip labels run past the strip (${bars.length} clips)`);
  return {
    html: bars.map((bar) => bar.html).join("") + unit("rc-cliplabels pre", bars.map((bar) => bar.label).join("")),
    motion: [
      ...bars.flatMap((bar) => bar.motion),
      { target: ".rc-cliplabels", at: countAt + up, from: { opacity: 0 }, to: { opacity: 1, duration: 0.2, ease: "power2.out" } },
      fadeAway(".rc-cliplabels", collapseAt),
    ],
  };
}

// The removals as stripes on the bars, and the kept stretches that replace them and pack to the left.
function stripes(layout) {
  const { px, x, bad, pauses, badAt, pausesAt, collapseAt, kept } = layout;
  const rect = (item, fill) => barRect(px(item.start), Math.max(R.minStripe, px(item.end) - px(item.start)), fill);
  const group = ([name, items, fill, at]) => ({
    html: unit(`${name} pre`, items.map((item) => rect(item, fill)).join(""), [x, R.barY + R.barHeight / 2]),
    motion: [
      { target: `.${name}`, at, from: { opacity: 0, scaleY: 0.3 }, to: { opacity: 1, scaleY: 1, duration: 0.18, ease: "power3.out" } },
      fadeAway(`.${name}`, collapseAt),
    ],
  });
  let packed = x;
  const blocks = kept.map((item, index) => {
    const [left, width] = [px(item.start), Math.max(1, px(item.end) - px(item.start))];
    const shift = packed - left;
    packed += width + R.keptGap;
    return {
      html: unit(`rc-kept${index} pre`, barRect(left, width, LEARNING.ink)),
      motion: [
        { target: `.rc-kept${index}`, at: collapseAt, from: { opacity: 0 }, to: { opacity: 1, duration: 0.12, ease: "power2.out" } },
        { target: `.rc-kept${index}`, at: collapseAt + 0.1, from: { x: 0 }, to: { x: shift, duration: R.down - 0.1, ease: "power3.inOut" } },
      ],
    };
  });
  const groups = [
    ["rc-bad", bad, LEARNING.bad, badAt],
    ["rc-pause", pauses, R.pause, pausesAt],
  ].filter(([, items]) => items.length);
  return merged([...groups.map(group), ...blocks]);
}

// kept / bad takes / pauses, each item arriving with its stripes; the removal items leave on the collapse.
function legend(layout) {
  const { x, bad, pauses, badAt, pausesAt, collapseAt } = layout;
  const font = { ...MONO, size: R.legendSize };
  const y = R.barY + R.barHeight + R.legendGap;
  const dot = (fill) => (cx) => `<circle cx="${cx}" cy="${y - 7}" r="7" fill="${fill}"/>`;
  const square = (cx) => `<rect x="${cx - 7}" y="${y - 14}" width="14" height="14" fill="${LEARNING.ink}"/>`;
  const items = [
    ["kept", square, bad.length ? badAt : pauses.length ? pausesAt : collapseAt, false],
    ...(bad.length ? [["bad takes", dot(LEARNING.bad), badAt, true]] : []),
    ...(pauses.length ? [["pauses", dot(R.clip), pausesAt, true]] : []),
  ];
  let left = x;
  const html = items.map(([text, mark], index) => {
    const svg = mark(left + 7) + glyph(text, left + 22, y, font, LEARNING.ink, ' fill-opacity="0.7"');
    left += 22 + advanceWidth(text, font) + 28;
    return unit(`rc-leg${index} pre`, svg);
  });
  const motion = items.flatMap(([, , at, leaves], index) => [show(`.rc-leg${index}`, at), ...(leaves ? [fadeAway(`.rc-leg${index}`, collapseAt)] : [])]);
  return { html: html.join(""), motion };
}

const receipt = {
  sfx: (cue, duration) => {
    const { countAt, up, bad, pauses, badAt, pausesAt, collapseAt, landing, moves } = receiptLayout(cue, duration);
    return [
      { at: countAt, sound: "count", dur: up },
      ...(bad.length ? [{ at: badAt, sound: "tick" }] : []),
      ...(pauses.length ? [{ at: pausesAt, sound: "tick" }] : []),
      ...(moves ? [{ at: collapseAt, sound: "count", dur: R.down }] : []),
      { at: landing, sound: "hook" },
    ];
  },
  render(cue, { duration }) {
    const layout = receiptLayout(cue, duration);
    const parts = merged([counter(layout), clipBars(cue, layout), stripes(layout), legend(layout)]);
    const labels = unit("rc-label-in", microLabel("— input", layout.x, R.labelY)) + unit("rc-label-out pre", microLabel("— output", layout.x, R.labelY));
    return {
      html: unit("rc", "", [layout.x, R.barY], labels + parts.html),
      motion: [...rise(".rc", 0, { distance: 16 }), hide(".rc-label-in", layout.collapseAt), show(".rc-label-out", layout.collapseAt), ...parts.motion],
      exit: fadeOut(".rc", duration),
    };
  },
};

module.exports = { receipt };
