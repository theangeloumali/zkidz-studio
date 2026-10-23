// Created by The Angelo Umali.
import { createContext, useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { formatTimecode } from "../lib/format.ts";
import { editedDuration, editedToSource, type TimeSpan } from "./edl.ts";
import type { PlaybackClock } from "./playback-clock.ts";
import { mergeDensityRuns } from "./timeline-density.ts";
import { TimelineHead } from "./timeline-head.tsx";
import { TRACK_IDS, type TimelineTracks } from "./timeline-items.ts";
import { TimelineLane, TRACK_META } from "./timeline-lane.tsx";
import { TimelineRuler } from "./timeline-ruler.tsx";
import { followScrollLeft, LABEL_WIDTH_PX, MAX_PIXELS_PER_SECOND, rulerTicks } from "./timeline-scale.ts";
import { indexTimelineItems, visibleItems } from "./timeline-window.ts";
import { useTimelineView, viewportOf } from "./use-timeline-view.ts";

/** The lane scale, for things drawn over a lane (the cut chips). */
export const PixelsPerSecondContext = createContext(MAX_PIXELS_PER_SECOND);

const SEEK_STEP_S = 1;
const SHIFT_SEEK_STEP_S = 10;
const ZOOM_STEP = 2;

interface TimelineProps {
  readonly tracks: TimelineTracks;
  readonly sourceDurationS: number;
  readonly keptSpans: readonly TimeSpan[];
  readonly clock: PlaybackClock;
  /** Shown in the head beside the zoom controls: the edit's length. */
  readonly meta?: ReactNode;
  /** Drawn over the video lane: the cut candidates waiting for a decision. */
  readonly videoLaneExtras?: ReactNode;
}

const sliderValue = (editedS: number) => Math.round(editedS * 10) / 10;
const sliderText = (editedS: number, lengthS: number) => `${formatTimecode(editedS)} of ${formatTimecode(lengthS)}`;

/** Lanes are laid out in source seconds, so cuts stay visible as hatched gaps; only blocks near the viewport are in the DOM. */
export function Timeline({ tracks, sourceDurationS, keptSpans, clock, meta, videoLaneExtras }: TimelineProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const { pixelsPerSecond, fitPps, viewportPx, visibleWindow, zoomAround } = useTimelineView(scrollerRef, sourceDurationS);
  const editedLengthS = useMemo(() => editedDuration(keptSpans), [keptSpans]);
  // Cut marks are drawn but not counted (spec §6).
  const itemCounts = useMemo(
    () => Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, tracks[trackId].filter((block) => block.variant !== "cut").length])),
    [tracks],
  );
  const noMedia = sourceDurationS <= 0;
  const indexes = useMemo(
    () =>
      Object.fromEntries(
        TRACK_IDS.map((trackId) => [trackId, indexTimelineItems(mergeDensityRuns(tracks[trackId], pixelsPerSecond, TRACK_META[trackId].itemNoun))]),
      ),
    [tracks, pixelsPerSecond],
  );

  useEffect(() => {
    const update = (editedS: number) => {
      const scroller = scrollerRef.current;
      if (scroller === null || playheadRef.current === null || sliderRef.current === null) return;
      const playheadPx = editedToSource(keptSpans, editedS) * pixelsPerSecond;
      // Reads before writes; the view jumps a viewport rather than scrolling smoothly (spec §6.2).
      const nextScrollLeft = clock.isPlaying() ? followScrollLeft(LABEL_WIDTH_PX + playheadPx, scroller.scrollLeft, viewportOf(scroller)) : null;
      if (nextScrollLeft !== null) scroller.scrollLeft = nextScrollLeft;
      playheadRef.current.style.transform = `translateX(${playheadPx}px)`;
      sliderRef.current.setAttribute("aria-valuenow", String(sliderValue(editedS)));
      sliderRef.current.setAttribute("aria-valuetext", sliderText(editedS, editedLengthS));
    };
    update(clock.now());
    return clock.subscribe(update);
  }, [clock, keptSpans, pixelsPerSecond, editedLengthS]);

  const zoomAroundPlayhead = (factor: number) => {
    const scrollLeft = scrollerRef.current?.scrollLeft ?? 0;
    const playheadOffsetPx = LABEL_WIDTH_PX + editedToSource(keptSpans, clock.now()) * pixelsPerSecond - scrollLeft;
    zoomAround(pixelsPerSecond * factor, playheadOffsetPx);
  };

  const onSliderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (noMedia) return;
    const step = event.shiftKey ? SHIFT_SEEK_STEP_S : SEEK_STEP_S;
    const nowS = clock.now();
    const seekTargets: Readonly<Record<string, number>> = {
      ArrowRight: nowS + step,
      ArrowUp: nowS + step,
      ArrowLeft: nowS - step,
      ArrowDown: nowS - step,
      Home: 0,
      End: editedLengthS,
    };
    const seekTo = seekTargets[event.key];
    if (seekTo !== undefined) clock.seek(Math.min(editedLengthS, Math.max(0, seekTo)));
    else if (event.key === "+" || event.key === "=") zoomAroundPlayhead(ZOOM_STEP);
    else if (event.key === "-" || event.key === "_") zoomAroundPlayhead(1 / ZOOM_STEP);
    else return;
    event.preventDefault();
  };

  const nowS = clock.now();
  return (
    <>
      <TimelineHead
        meta={meta}
        canZoomIn={!noMedia && pixelsPerSecond < MAX_PIXELS_PER_SECOND}
        canZoomOut={!noMedia && pixelsPerSecond > fitPps}
        onZoomIn={() => zoomAround(pixelsPerSecond * ZOOM_STEP, viewportPx / 2)}
        onZoomOut={() => zoomAround(pixelsPerSecond / ZOOM_STEP, viewportPx / 2)}
        onFit={() => zoomAround(fitPps, LABEL_WIDTH_PX)}
      />
      <div ref={scrollerRef} className="timeline-scroll">
        <div className="timeline" style={{ width: LABEL_WIDTH_PX + sourceDurationS * pixelsPerSecond, minWidth: "100%" }}>
          <TimelineRuler
            sliderRef={sliderRef}
            ticks={rulerTicks(visibleWindow, pixelsPerSecond, sourceDurationS)}
            pixelsPerSecond={pixelsPerSecond}
            editedLengthS={sliderValue(editedLengthS)}
            valueS={sliderValue(nowS)}
            valueText={sliderText(nowS, editedLengthS)}
            disabled={noMedia}
            onKeyDown={onSliderKeyDown}
          />
          <PixelsPerSecondContext value={pixelsPerSecond}>
            {TRACK_IDS.map((trackId) => {
              const index = indexes[trackId];
              return (
                <TimelineLane
                  key={trackId}
                  trackId={trackId}
                  blocks={index === undefined ? [] : visibleItems(index, visibleWindow.startS, visibleWindow.endS)}
                  itemCount={itemCounts[trackId] ?? 0}
                  pixelsPerSecond={pixelsPerSecond}
                >
                  {trackId === "video" && videoLaneExtras}
                </TimelineLane>
              );
            })}
          </PixelsPerSecondContext>
          <div ref={playheadRef} className="playhead" aria-hidden="true" />
        </div>
      </div>
    </>
  );
}
