// Created by The Angelo Umali.
import { formatDuration } from "../lib/format.ts";
import type { TimelineBlock } from "./timeline-items.ts";

/** Below this on-screen width a block is not drawn alone (spec §6.1). */
const MIN_DRAWN_PX = 2;

/** Neighbouring blocks too thin to draw, merged into one bar; its label is its title and accessible name. */
export interface DensityRun extends TimelineBlock {
  readonly runCount: number;
}

export type DrawnBlock = TimelineBlock | DensityRun;

export const isDensityRun = (block: DrawnBlock): block is DensityRun => "runCount" in block;

// Cut marks and SFX diamonds have their own merge rules, so they always pass through.
const canMerge = (block: TimelineBlock, minDrawnS: number) => block.variant !== "cut" && block.variant !== "sfx" && block.end - block.at < minDrawnS;

/** One run for 2+ members; a lone thin block stays itself at its 2 px minimum. */
function drawnFrom(members: readonly TimelineBlock[], itemNoun: string): DrawnBlock[] {
  const [first] = members;
  if (first === undefined || members.length === 1) return [...members];
  const end = Math.max(...members.map((member) => member.end));
  const label = `${members.length} ${itemNoun}, ${formatDuration(first.at)}–${formatDuration(end)}`;
  return [{ id: `run-${first.id}`, variant: first.variant, at: first.at, end, label, runCount: members.length }];
}

/** A lane's blocks as drawn at `pixelsPerSecond`: thin neighbours under 2 px apart become one density run. */
export function mergeDensityRuns(blocks: readonly TimelineBlock[], pixelsPerSecond: number, itemNoun: string): DrawnBlock[] {
  const minDrawnS = MIN_DRAWN_PX / pixelsPerSecond;
  const drawn: DrawnBlock[] = [];
  let pending: TimelineBlock[] = [];
  let pendingEnd = Number.NEGATIVE_INFINITY;
  for (const block of [...blocks].sort((left, right) => left.at - right.at)) {
    if (!canMerge(block, minDrawnS)) {
      drawn.push(block);
      continue;
    }
    if (block.at - pendingEnd >= minDrawnS) {
      drawn.push(...drawnFrom(pending, itemNoun));
      pending = [];
    }
    pending.push(block);
    pendingEnd = Math.max(pendingEnd, block.end);
  }
  drawn.push(...drawnFrom(pending, itemNoun));
  return drawn;
}
