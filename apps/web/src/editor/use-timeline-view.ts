// Created by The Angelo Umali.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { anchoredScrollLeft, clampZoom, fitPixelsPerSecond, LABEL_WIDTH_PX, MAX_PIXELS_PER_SECOND } from "./timeline-scale.ts";
import { mountedWindow, type SecondsWindow } from "./timeline-window.ts";

/** jsdom and a not-yet-laid-out pane report 0 wide; draw a desktop-width window instead of nothing. */
const FALLBACK_VIEWPORT_PX = 1280;
const WHEEL_ZOOM_RATE = 0.002;
const LINE_HEIGHT_PX = 16;

export const viewportOf = (scroller: HTMLElement) => scroller.clientWidth || FALLBACK_VIEWPORT_PX;

function viewWindow(scrollLeft: number, viewportPx: number, pixelsPerSecond: number): SecondsWindow {
  const startS = (scrollLeft - LABEL_WIDTH_PX) / pixelsPerSecond;
  return mountedWindow(startS, startS + viewportPx / pixelsPerSecond);
}

const sameWindow = (left: SecondsWindow, right: SecondsWindow) => left.startS === right.startS && left.endS === right.endS;

/** Zoom and the mounted window. Every zoom source funnels into `zoomAround`, which renders once and scrolls before paint. */
export function useTimelineView(scrollerRef: RefObject<HTMLDivElement | null>, durationS: number) {
  const [viewportPx, setViewportPx] = useState(FALLBACK_VIEWPORT_PX);
  const [requestedPps, setRequestedPps] = useState(MAX_PIXELS_PER_SECOND);
  const fitPps = fitPixelsPerSecond(viewportPx - LABEL_WIDTH_PX, durationS);
  const pixelsPerSecond = clampZoom(requestedPps, fitPps);
  const [visibleWindow, setVisibleWindow] = useState(() => viewWindow(0, FALLBACK_VIEWPORT_PX, MAX_PIXELS_PER_SECOND));
  const scaleRef = useRef({ pixelsPerSecond, fitPps, durationS });
  const pendingScrollLeft = useRef<number | null>(null);

  const syncWindow = useCallback((scroller: HTMLElement, scale: number) => {
    const next = viewWindow(scroller.scrollLeft, viewportOf(scroller), scale);
    // Keeping the old object lets React skip the render while the scroll stays inside one window step.
    setVisibleWindow((current) => (sameWindow(current, next) ? current : next));
  }, []);

  useLayoutEffect(() => {
    scaleRef.current = { pixelsPerSecond, fitPps, durationS };
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    if (pendingScrollLeft.current !== null) scroller.scrollLeft = pendingScrollLeft.current;
    pendingScrollLeft.current = null;
    syncWindow(scroller, pixelsPerSecond);
  }, [scrollerRef, syncWindow, pixelsPerSecond, fitPps, durationS]);

  /** Zooms keeping the time under `anchorOffsetPx` (from the scroller's left edge) where it is on screen. */
  const zoomAround = useCallback(
    (nextPps: number, anchorOffsetPx: number) => {
      const scroller = scrollerRef.current;
      if (scroller === null) return;
      const scale = scaleRef.current;
      const target = clampZoom(nextPps, scale.fitPps);
      const anchorS = (scroller.scrollLeft + anchorOffsetPx - LABEL_WIDTH_PX) / scale.pixelsPerSecond;
      const maxScrollLeft = Math.max(0, LABEL_WIDTH_PX + scale.durationS * target - viewportOf(scroller));
      const scrollLeft = Math.min(maxScrollLeft, Math.max(0, anchoredScrollLeft(anchorS, anchorOffsetPx, target)));
      pendingScrollLeft.current = scrollLeft;
      setRequestedPps(target);
      setVisibleWindow(viewWindow(scrollLeft, viewportOf(scroller), target));
    },
    [scrollerRef],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    let scrollFrame: number | null = null;
    let zoomFrame: number | null = null;
    let wheelFactor = 1;
    let pointerX = 0;
    const onScroll = () => {
      scrollFrame ??= requestAnimationFrame(() => {
        scrollFrame = null;
        setViewportPx(viewportOf(scroller));
        syncWindow(scroller, scaleRef.current.pixelsPerSecond);
      });
    };
    // Ctrl/⌘ + wheel and trackpad pinch (which arrives as Ctrl + wheel); applied once per frame, not per event.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const deltaPx = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * LINE_HEIGHT_PX : event.deltaY;
      wheelFactor *= Math.exp(-deltaPx * WHEEL_ZOOM_RATE);
      pointerX = event.clientX;
      zoomFrame ??= requestAnimationFrame(() => {
        zoomFrame = null;
        zoomAround(scaleRef.current.pixelsPerSecond * wheelFactor, pointerX - scroller.getBoundingClientRect().left);
        wheelFactor = 1;
      });
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onScroll);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      if (zoomFrame !== null) cancelAnimationFrame(zoomFrame);
    };
  }, [scrollerRef, syncWindow, zoomAround]);

  return { pixelsPerSecond, fitPps, viewportPx, visibleWindow, zoomAround };
}
