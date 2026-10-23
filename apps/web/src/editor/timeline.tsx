// Created by The Angelo Umali.
import { AudioLines, Film, Layers, Type, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDuration } from "../lib/format.ts";
import { editedToSource, type TimeSpan } from "./edl.ts";
import type { PlaybackClock } from "./playback-clock.ts";
import { isDensityRun, mergeDensityRuns, type DrawnBlock } from "./timeline-density.ts";
import { TRACK_IDS, type TimelineTracks, type TrackId } from "./timeline-items.ts";
import { indexTimelineItems, mountedWindow, visibleItems, type SecondsWindow } from "./timeline-window.ts";

export const PIXELS_PER_SECOND = 40;
/** jsdom and a not-yet-laid-out pane report 0 wide; draw a desktop-width window instead of nothing. */
const FALLBACK_VIEWPORT_PX = 1280;
const LABEL_WIDTH_PX = 104;

const TRACK_META: Record<TrackId, { readonly label: string; readonly itemNoun: string; readonly Icon: LucideIcon }> = {
  video: { label: "Video", itemNoun: "edits", Icon: Film },
  captions: { label: "Captions", itemNoun: "captions", Icon: Type },
  cues: { label: "Cues", itemNoun: "cues", Icon: Layers },
  audio: { label: "Audio", itemNoun: "sound effects", Icon: AudioLines },
};

interface TimelineProps {
  readonly tracks: TimelineTracks;
  readonly sourceDurationS: number;
  readonly keptSpans: readonly TimeSpan[];
  readonly clock: PlaybackClock;
  /** Drawn over the video lane: the cut candidates waiting for a decision. */
  readonly videoLaneExtras?: ReactNode;
}

function windowFor(scroller: HTMLElement | null): SecondsWindow {
  const viewportPx = scroller?.clientWidth || FALLBACK_VIEWPORT_PX;
  const startS = ((scroller?.scrollLeft ?? 0) - LABEL_WIDTH_PX) / PIXELS_PER_SECOND;
  return mountedWindow(startS, startS + viewportPx / PIXELS_PER_SECOND);
}

const sameWindow = (left: SecondsWindow, right: SecondsWindow) => left.startS === right.startS && left.endS === right.endS;

function blockStyle(block: DrawnBlock) {
  const left = block.at * PIXELS_PER_SECOND;
  return block.variant === "sfx" ? { left } : { left, width: Math.max(2, (block.end - block.at) * PIXELS_PER_SECOND) };
}

/** Lanes are laid out in source seconds, so cuts stay visible as hatched gaps; only blocks near the viewport are in the DOM. */
export function Timeline({ tracks, sourceDurationS, keptSpans, clock, videoLaneExtras }: TimelineProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [visibleWindow, setVisibleWindow] = useState<SecondsWindow>(() => windowFor(null));
  const indexes = useMemo(
    () =>
      Object.fromEntries(
        TRACK_IDS.map((trackId) => [trackId, indexTimelineItems(mergeDensityRuns(tracks[trackId], PIXELS_PER_SECOND, TRACK_META[trackId].itemNoun))]),
      ),
    [tracks],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    let pendingFrame: number | null = null;
    const onScroll = () => {
      pendingFrame ??= requestAnimationFrame(() => {
        pendingFrame = null;
        const next = windowFor(scroller);
        // Keeping the old object lets React skip the render while the scroll stays inside one window step.
        setVisibleWindow((current) => (sameWindow(current, next) ? current : next));
      });
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    };
  }, []);

  useEffect(() => {
    const movePlayhead = (editedS: number) => {
      if (playheadRef.current === null) return;
      playheadRef.current.style.transform = `translateX(${editedToSource(keptSpans, editedS) * PIXELS_PER_SECOND}px)`;
    };
    movePlayhead(clock.now());
    return clock.subscribe(movePlayhead);
  }, [clock, keptSpans]);

  return (
    <div ref={scrollerRef} className="timeline-scroll">
      <div className="timeline" style={{ width: LABEL_WIDTH_PX + sourceDurationS * PIXELS_PER_SECOND, minWidth: "100%" }}>
        {TRACK_IDS.map((trackId) => {
          const { label, Icon } = TRACK_META[trackId];
          const index = indexes[trackId];
          const blocks = index === undefined ? [] : visibleItems(index, visibleWindow.startS, visibleWindow.endS);
          return (
            <div key={trackId} className="track" data-track={trackId}>
              <span className="track-label" id={`track-${trackId}`}>
                <Icon aria-hidden="true" className="size-3.5 text-copy-dim" />
                {label}
              </span>
              <ul className="track-lane" aria-labelledby={`track-${trackId}`} data-testid={`lane-${trackId}`}>
                {blocks.map((block) =>
                  isDensityRun(block) ? (
                    <li key={block.id} className={`blk blk-${block.variant} blk-run`} style={blockStyle(block)} title={block.label}>
                      {block.label}
                    </li>
                  ) : (
                    <li key={block.id} className={`blk blk-${block.variant}`} style={blockStyle(block)} title={block.label || undefined}>
                      <span className="sr-only">
                        {block.variant} {formatDuration(block.at)}–{formatDuration(block.end)}{" "}
                      </span>
                      {block.variant === "cut" || block.variant === "sfx" ? null : block.label}
                    </li>
                  ),
                )}
                {trackId === "video" && videoLaneExtras}
              </ul>
            </div>
          );
        })}
        <div ref={playheadRef} className="playhead" aria-hidden="true" />
      </div>
    </div>
  );
}
