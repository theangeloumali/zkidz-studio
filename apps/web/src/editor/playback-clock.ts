// Created by The Angelo Umali.

type ClockListener = (editedS: number) => void;
/** The followed media's position in edited seconds, or null while it cannot say (seeking, not loaded). */
type MediaTimeReader = () => number | null;

interface ClockOptions {
  readonly durationS: number;
  readonly now?: () => number;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export interface PlaybackClock {
  play(): void;
  pause(): void;
  seek(editedS: number): void;
  now(): number;
  isPlaying(): boolean;
  setDuration(durationS: number): void;
  /** While playing, time comes from this media instead of the wall clock; null detaches it. */
  follow(readMediaS: MediaTimeReader | null): void;
  /** Called on every animation frame while playing, and on every seek or pause. */
  subscribe(listener: ClockListener): () => void;
}

/**
 * The one time source the proxy video and the overlay iframe both follow.
 * Media-led: the playing proxy sets the time, so the overlay never runs ahead of a stalled decoder. The wall clock
 * only bridges gaps. Plan §9.3 wants the mixed audio to lead, but no route serves it yet, so the proxy leads instead.
 */
export function createPlaybackClock(options: ClockOptions): PlaybackClock {
  const readNow = options.now ?? (() => performance.now());
  const requestFrame = options.requestFrame ?? ((callback: FrameRequestCallback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));
  const listeners = new Set<ClockListener>();
  let durationS = options.durationS;
  let anchorS = 0;
  let anchorMs: number | null = null;
  let frameHandle: number | null = null;
  let readMediaS: MediaTimeReader | null = null;

  function currentS(): number {
    if (anchorMs === null) return anchorS;
    const mediaS = readMediaS?.() ?? null;
    if (mediaS === null) return Math.min(durationS, anchorS + (readNow() - anchorMs) / 1000);
    // Re-anchored on every media reading, so the wall clock carries on from it if the media goes quiet.
    anchorS = Math.min(durationS, mediaS);
    anchorMs = readNow();
    return anchorS;
  }
  const notify = () => listeners.forEach((listener) => listener(currentS()));

  function stopFrames(): void {
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
  }

  function onFrame(): void {
    frameHandle = null;
    if (anchorMs === null) return;
    if (currentS() >= durationS) {
      clock.pause();
      return;
    }
    notify();
    frameHandle = requestFrame(onFrame);
  }

  const clock: PlaybackClock = {
    play() {
      if (anchorMs !== null) return;
      if (anchorS >= durationS) anchorS = 0;
      anchorMs = readNow();
      frameHandle = requestFrame(onFrame);
    },
    pause() {
      anchorS = currentS();
      anchorMs = null;
      stopFrames();
      notify();
    },
    seek(editedS) {
      anchorS = Math.min(durationS, Math.max(0, editedS));
      if (anchorMs !== null) anchorMs = readNow();
      notify();
    },
    now: currentS,
    isPlaying: () => anchorMs !== null,
    setDuration(nextDurationS) {
      durationS = nextDurationS;
      if (currentS() > durationS) clock.seek(durationS);
    },
    follow(reader) {
      readMediaS = reader;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return clock;
}
