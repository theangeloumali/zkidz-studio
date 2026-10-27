// Created by The Angelo Umali.

/** Two 1.5rem toggles plus gap, padding and border at a 16 px root: a chip never draws narrower than its buttons. */
export const CHIP_MIN_WIDTH_PX = 56;
const CHIP_GAP_PX = 2;

interface ChipSpan {
  readonly id: string;
  readonly at: number;
  readonly end: number;
}

export interface ChipBox {
  readonly left: number;
  readonly width: number;
}

/** Each chip starts at its cut unless the chip before it reaches past that, then just after it, so no chip covers another's buttons. */
export function layoutCutChips(spans: readonly ChipSpan[], pixelsPerSecond: number): ReadonlyMap<string, ChipBox> {
  const boxes = new Map<string, ChipBox>();
  let previousRightPx = -Infinity;
  for (const span of spans.toSorted((first, second) => first.at - second.at)) {
    const width = Math.max(CHIP_MIN_WIDTH_PX, (span.end - span.at) * pixelsPerSecond);
    const left = Math.max(span.at * pixelsPerSecond, previousRightPx + CHIP_GAP_PX);
    boxes.set(span.id, { left, width });
    previousRightPx = left + width;
  }
  return boxes;
}
