// Created by The Angelo Umali.
import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { anchoredScrollLeft, clampZoom, fitPixelsPerSecond, LABEL_WIDTH_PX, MAX_PIXELS_PER_SECOND } from "./timeline-scale.ts";
import { mountedWindow, type SecondsWindow } from "./timeline-window.ts";

/** jsdom and a not-yet-laid-out pane report 0 wide; draw a desktop-width window instead of nothing. */
const FALLBACK_VIEWPORT_PX = 1280;
const WHEEL_ZOOM_RATE = 0.002;
const LINE_HEIGHT_PX = 16;
// A wheel zoom mounts only the viewport (each step lays out every mounted block); the overscan returns once it settles.
const ZOOM_SETTLE_MS = 150;

export const viewportOf = (scroller: HTMLElement) => scroller.clientWidth || FALLBACK_VIEWPORT_PX;

function viewWindow(scrollLeft: number, viewportPx: number, pixelsPerSecond: number, overscanViewports: number): SecondsWindow {
  const startS = (scrollLeft - LABEL_WIDTH_PX) / pixelsPerSecond;
  return mountedWindow(startS, startS + viewportPx / pixelsPerSecond, overscanViewports);
}

const sameWindow = (left: SecondsWindow, right: SecondsWindow) => left.startS === right.startS && left.endS === right.endS;

/** Zoom and the mounted window. Every zoom source funnels into `zoomAround`, which renders once and scrolls before paint. */
export function useTimelineView(scrollerRef: RefObject<HTMLDivElement | null>, durationS: number) {
  const [viewportPx, setViewportPx] = useState(FALLBACK_VIEWPORT_PX);
  const [requestedPps, setRequestedPps] = useState(MAX_PIXELS_PER_SECOND);
  const fitPps = fitPixelsPerSecond(viewportPx - LABEL_WIDTH_PX, durationS);
  const pixelsPerSecond = clampZoom(requestedPps, fitPps);
  const [visibleWindow, setVisibleWindow] = useState(() => viewWindow(0, FALLBACK_VIEWPORT_PX, MAX_PIXELS_PER_SECOND, 1));
  const scaleRef = useRef({ pixelsPerSecond, fitPps, durationS });
  const pendingScrollLeft = useRef<number | null>(null);
  // 0 while a wheel zoom runs, so its own scroll events re-render without the margins; any other scroll or zoom restores them.
  const overscanViewports = useRef(1);
  const zoomScrollLeft = useRef(0);

  const syncWindow = useCallback((scroller: HTMLElement, scale: number) => {
    const next = viewWindow(scroller.scrollLeft, viewportOf(scroller), scale, overscanViewports.current);
    // Keeping the old object lets React skip the render while the scroll stays inside one window step.
    setVisibleWindow((current) => (sameWindow(current, next) ? current : next));
  }, []);

  useLayoutEffect(() => {
    scaleRef.current = { pixelsPerSecond, fitPps, durationS };
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    // zoomAround already set the window for this scrollLeft; reading it back would force a second layout.
    if (pendingScrollLeft.current === null) syncWindow(scroller, pixelsPerSecond);
    else scroller.scrollLeft = pendingScrollLeft.current;
    pendingScrollLeft.current = null;
  }, [scrollerRef, syncWindow, pixelsPerSecond, fitPps, durationS]);

  /** Zooms keeping the time under `anchorOffsetPx` (from the scroller's left edge) where it is on screen; false at a zoom limit. */
  const zoomAround = useCallback(
    (nextPps: number, anchorOffsetPx: number, overscan = 1) => {
      const scroller = scrollerRef.current;
      if (scroller === null) return false;
      const scale = scaleRef.current;
      const target = clampZoom(nextPps, scale.fitPps);
      // No render follows an unchanged zoom, so a pending scrollLeft would wait for some later layout and jump the view.
      if (target === scale.pixelsPerSecond) return false;
      const anchorS = (scroller.scrollLeft + anchorOffsetPx - LABEL_WIDTH_PX) / scale.pixelsPerSecond;
      const maxScrollLeft = Math.max(0, LABEL_WIDTH_PX + scale.durationS * target - viewportOf(scroller));
      const scrollLeft = Math.min(maxScrollLeft, Math.max(0, anchoredScrollLeft(anchorS, anchorOffsetPx, target)));
      overscanViewports.current = overscan;
      pendingScrollLeft.current = scrollLeft;
      zoomScrollLeft.current = scrollLeft;
      setRequestedPps(target);
      setVisibleWindow(viewWindow(scrollLeft, viewportOf(scroller), target, overscan));
      return true;
    },
    [scrollerRef],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    let scrollFrame: number | null = null;
    let zoomFrame: number | null = null;
    let zoomSettle: ReturnType<typeof setTimeout> | undefined;
    let wheelFactor = 1;
    let pointerX = 0;
    const onScroll = () => {
      scrollFrame ??= requestAnimationFrame(() => {
        scrollFrame = null;
        if (Math.abs(scroller.scrollLeft - zoomScrollLeft.current) > 1) overscanViewports.current = 1;
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
        // A rAF setState renders in a scheduler task after paint, so each step would land a frame late (§9.5 zoom trace).
        const isZoomed = flushSync(() => zoomAround(scaleRef.current.pixelsPerSecond * wheelFactor, pointerX - scroller.getBoundingClientRect().left, 0));
        wheelFactor = 1;
        if (!isZoomed) return;
        clearTimeout(zoomSettle);
        zoomSettle = setTimeout(() => {
          overscanViewports.current = 1;
          // Three viewports of blocks: a transition yields, so a zoom step resuming mid-render jumps ahead of it.
          startTransition(() => syncWindow(scroller, scaleRef.current.pixelsPerSecond));
        }, ZOOM_SETTLE_MS);
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
      clearTimeout(zoomSettle);
    };
  }, [scrollerRef, syncWindow, zoomAround]);

  return { pixelsPerSecond, fitPps, viewportPx, visibleWindow, zoomAround };
}
