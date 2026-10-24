// Created by The Angelo Umali.
import type { SecondsWindow } from "./timeline-window.ts";

/** The closest zoom (spec §6.2); Fit is the farthest. */
export const MAX_PIXELS_PER_SECOND = 40;
/** The sticky track-label column, `--label-w` in editor.css. */
export const LABEL_WIDTH_PX = 104;

const RULER_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600] as const;
const MIN_TICK_GAP_PX = 64;
const LABEL_MIN_PX = 48;
const RING_MIN_PX = 6;

export function fitPixelsPerSecond(laneWidthPx: number, durationS: number): number {
  return durationS > 0 ? Math.min(MAX_PIXELS_PER_SECOND, laneWidthPx / durationS) : MAX_PIXELS_PER_SECOND;
}

export function clampZoom(pixelsPerSecond: number, fitPps: number): number {
  return Math.min(MAX_PIXELS_PER_SECOND, Math.max(fitPps, pixelsPerSecond));
}

export function rulerTickStepS(pixelsPerSecond: number): number {
  return RULER_STEPS_S.find((stepS) => stepS * pixelsPerSecond >= MIN_TICK_GAP_PX) ?? RULER_STEPS_S.at(-1) ?? 1;
}

/** Tick seconds inside the mounted window, so a 40 px/s ruler mounts tens of ticks, not hundreds. */
export function rulerTicks(window: SecondsWindow, pixelsPerSecond: number, durationS: number): number[] {
  const stepS = rulerTickStepS(pixelsPerSecond);
  const ticks: number[] = [];
  for (let tickS = Math.max(0, Math.ceil(window.startS / stepS) * stepS); tickS <= Math.min(window.endS, durationS); tickS += stepS) ticks.push(tickS);
  return ticks;
}

export type BlockLod = "label" | "bare" | "sliver";

/** Spec §6.1 level of detail; blocks under 2 px are density runs before they get here. */
export function blockLod(widthPx: number): BlockLod {
  if (widthPx >= LABEL_MIN_PX) return "label";
  return widthPx >= RING_MIN_PX ? "bare" : "sliver";
}

/** The scrollLeft that keeps `anchorS` under the same viewport x at the new zoom. */
export function anchoredScrollLeft(anchorS: number, anchorOffsetPx: number, pixelsPerSecond: number): number {
  return LABEL_WIDTH_PX + anchorS * pixelsPerSecond - anchorOffsetPx;
}

/** During playback the view jumps a whole viewport when the playhead runs off the right edge; never a smooth scroll. */
export function followScrollLeft(playheadPx: number, scrollLeft: number, viewportPx: number): number | null {
  return playheadPx > scrollLeft + viewportPx ? scrollLeft + viewportPx - LABEL_WIDTH_PX : null;
}
