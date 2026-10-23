// Created by The Angelo Umali.
import { formatDuration } from "../lib/format.ts";
import type { TimelineBlock } from "./timeline-items.ts";

/** Below this on-screen width a block is not drawn alone (spec §6.1). */
const MIN_DRAWN_PX = 2;
const CUT_MERGE_PX = 3;
const SFX_MERGE_PX = 8;

/** Neighbours merged into one mark; its label is its title and accessible name. */
export interface DensityRun extends TimelineBlock {
  readonly runCount: number;
}

export type DrawnBlock = TimelineBlock | DensityRun;

export const isDensityRun = (block: DrawnBlock): block is DensityRun => "runCount" in block;

/** Cut marks and SFX diamonds: their own merge rules, and no visible label at any width. */
export const isMark = (block: TimelineBlock) => block.variant === "cut" || block.variant === "sfx";

type RunLabel = (members: readonly TimelineBlock[], end: number) => string;

const spanLabel =
  (itemNoun: string): RunLabel =>
  (members, end) =>
    `${members.length} ${itemNoun}, ${formatDuration(members[0]?.at ?? 0)}–${formatDuration(end)}`;
const soundEffectsLabel: RunLabel = (members) => `${members.length} sound effects`;

/** One run for 2+ members; a lone member stays itself. */
function drawnFrom(members: readonly TimelineBlock[], label: RunLabel): DrawnBlock[] {
  const [first] = members;
  if (first === undefined || members.length === 1) return [...members];
  const end = Math.max(...members.map((member) => member.end));
  return [{ id: `run-${first.id}`, variant: first.variant, at: first.at, end, label: label(members, end), runCount: members.length }];
}

/** Chains sorted blocks whose gap from the chain's reach is under `maxGapS`; SFX diamonds reach only to their start. */
function mergeChain(blocks: readonly TimelineBlock[], maxGapS: number, reach: (block: TimelineBlock) => number, label: RunLabel): DrawnBlock[] {
  const drawn: DrawnBlock[] = [];
  let pending: TimelineBlock[] = [];
  let pendingReach = Number.NEGATIVE_INFINITY;
  for (const block of blocks) {
    if (block.at - pendingReach >= maxGapS) {
      drawn.push(...drawnFrom(pending, label));
      pending = [];
      pendingReach = Number.NEGATIVE_INFINITY;
    }
    pending.push(block);
    pendingReach = Math.max(pendingReach, reach(block));
  }
  drawn.push(...drawnFrom(pending, label));
  return drawn;
}

const byStart = (left: DrawnBlock, right: DrawnBlock) => left.at - right.at;

/** A lane's blocks as drawn at `pixelsPerSecond`: thin blocks under 2 px, cut marks under 3 px and SFX under 8 px apart merge. */
export function mergeDensityRuns(blocks: readonly TimelineBlock[], pixelsPerSecond: number, itemNoun: string): DrawnBlock[] {
  const minDrawnS = MIN_DRAWN_PX / pixelsPerSecond;
  const sorted = [...blocks].sort(byStart);
  const cuts = sorted.filter((block) => block.variant === "cut");
  const soundEffects = sorted.filter((block) => block.variant === "sfx");
  const others = sorted.filter((block) => !isMark(block));
  const isThin = (block: TimelineBlock) => block.end - block.at < minDrawnS;
  return [
    ...others.filter((block) => !isThin(block)),
    ...mergeChain(others.filter(isThin), minDrawnS, (block) => block.end, spanLabel(itemNoun)),
    ...mergeChain(cuts, CUT_MERGE_PX / pixelsPerSecond, (block) => block.end, spanLabel("cuts")),
    ...mergeChain(soundEffects, SFX_MERGE_PX / pixelsPerSecond, (block) => block.at, soundEffectsLabel),
  ].sort(byStart);
}
