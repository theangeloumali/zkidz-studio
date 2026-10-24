// Created by The Angelo Umali.
import { useEffect, useRef, type PointerEvent, type RefObject } from "react";

/** Blocks, the cut chips' buttons and the sticky label column never seek. */
const NO_SEEK_SELECTOR = ".blk, .cut-chip, .track-label";

interface PointerSeekOptions {
  /** The ruler: its left edge is source 0 s on every lane. */
  readonly originRef: RefObject<HTMLElement | null>;
  readonly disabled: boolean;
  /** Seeks to a point this many pixels right of the origin. */
  readonly seekToOffset: (offsetPx: number) => void;
}

/** Press on the ruler or an empty lane to seek; drag to scrub, one seek per frame. */
export function usePointerSeek({ originRef, disabled, seekToOffset }: PointerSeekOptions) {
  const stopDragRef = useRef<() => void>(() => undefined);
  useEffect(() => () => stopDragRef.current(), []);

  return (event: PointerEvent<HTMLElement>) => {
    const origin = originRef.current;
    if (disabled || event.button !== 0 || origin === null) return;
    if (event.target instanceof Element && event.target.closest(NO_SEEK_SELECTOR) !== null) return;
    const seekAt = (clientX: number) => seekToOffset(clientX - origin.getBoundingClientRect().left);
    seekAt(event.clientX);

    let pendingX: number | null = null;
    let frame: number | null = null;
    const onMove = (move: globalThis.PointerEvent) => {
      pendingX = move.clientX;
      frame ??= requestAnimationFrame(() => {
        frame = null;
        if (pendingX !== null) seekAt(pendingX);
      });
    };
    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", stop);
    };
    const onUp = (up: globalThis.PointerEvent) => {
      stop();
      seekAt(up.clientX);
    };
    stopDragRef.current();
    stopDragRef.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", stop);
  };
}
