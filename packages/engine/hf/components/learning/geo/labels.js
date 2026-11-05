// Created by The Angelo Umali.
// Where a map pin's name goes: beside it (right first, then left), nudged up or down, then above or below. The first spot
// inside the bounds that clears the earlier labels and every pin wins; with none clean, the lowest-scoring one.
const PIN_RADIUS = 12;
const GAP = 24;
const CLEAR = 8;

const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (rect, by) => ({ x: rect.x - by, y: rect.y - by, w: rect.w + 2 * by, h: rect.h + 2 * by });

function placeLabel([px, py], { width, height }, [bx, by, bw, bh], taken, pins) {
  const nudges = [-height / 2, -height + 8, -8];
  const beside = nudges.flatMap((nudge) => [
    { side: "right", anchor: "start", x: px + GAP, y: py + nudge },
    { side: "left", anchor: "end", x: px - GAP - width, y: py + nudge },
  ]);
  const candidates = [
    ...beside,
    { side: "above", anchor: "middle", x: px - width / 2, y: py - GAP - height },
    { side: "below", anchor: "middle", x: px - width / 2, y: py + GAP },
  ];
  const scored = candidates.map((candidate, order) => {
    const rect = { x: candidate.x, y: candidate.y, w: width, h: height };
    const outside = rect.x < bx || rect.y < by || rect.x + rect.w > bx + bw || rect.y + rect.h > by + bh;
    const crowded = taken.filter((other) => hits(grow(rect, CLEAR), other)).length;
    const covered = pins.filter(([x, y]) => hits(rect, grow({ x, y, w: 0, h: 0 }, PIN_RADIUS + 4))).length;
    return { ...candidate, rect, score: (outside ? 1000 : 0) + (crowded + covered) * 1000 + order };
  });
  const best = scored.reduce((chosen, next) => (next.score < chosen.score ? next : chosen));
  // Never leave the box: slide the rect back in (bounds win over the box when the label is wider than the room).
  const x = Math.max(bx, Math.min(best.rect.x, bx + bw - width));
  const y = Math.max(by, Math.min(best.rect.y, by + bh - height));
  return { ...best, rect: { ...best.rect, x, y } };
}

module.exports = { placeLabel, PIN_RADIUS };
