// Created by The Angelo Umali.
import type { TimeSpan } from "./edl.ts";

export interface TimelineIndex<Item extends TimeSpan> {
  readonly items: readonly Item[];
  /** prefixMaxEnd[n] is the latest end among items[0..n]; it lets a long early item stay findable. */
  readonly prefixMaxEnd: readonly number[];
}

export function indexTimelineItems<Item extends TimeSpan>(items: readonly Item[]): TimelineIndex<Item> {
  const sortedItems = [...items].sort((left, right) => left.at - right.at);
  const prefixMaxEnd: number[] = [];
  let latestEnd = Number.NEGATIVE_INFINITY;
  for (const item of sortedItems) {
    latestEnd = Math.max(latestEnd, item.end);
    prefixMaxEnd.push(latestEnd);
  }
  return { items: sortedItems, prefixMaxEnd };
}

/** First index whose predicate holds, for a predicate that flips false → true once. */
function lowerBound(length: number, isAtOrPast: (position: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (isAtOrPast(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** The items overlapping [windowStart, windowEnd], found in O(log n + visible). */
export function visibleItems<Item extends TimeSpan>(index: TimelineIndex<Item>, windowStart: number, windowEnd: number): Item[] {
  const { items, prefixMaxEnd } = index;
  const first = lowerBound(items.length, (position) => (prefixMaxEnd[position] ?? 0) >= windowStart);
  const afterLast = lowerBound(items.length, (position) => (items[position]?.at ?? 0) > windowEnd);
  return items.slice(first, afterLast).filter((item) => item.end >= windowStart);
}

export interface SecondsWindow {
  readonly startS: number;
  readonly endS: number;
}

/** Window edges snap outward to this step, so a scroll re-renders the lanes once per step, not once per frame. */
const WINDOW_STEP_S = 10;

/** The mounted window for a viewport: at least `overscanS` past each edge, snapped outward to the step. */
export function mountedWindow(viewStartS: number, viewEndS: number, overscanS: number): SecondsWindow {
  return {
    startS: Math.floor((viewStartS - overscanS) / WINDOW_STEP_S) * WINDOW_STEP_S,
    endS: Math.ceil((viewEndS + overscanS) / WINDOW_STEP_S) * WINDOW_STEP_S,
  };
}
