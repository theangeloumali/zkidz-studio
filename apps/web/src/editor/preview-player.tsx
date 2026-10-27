// Created by The Angelo Umali.
import { CANVAS, PREVIEW_SEEK_MESSAGE, PreviewLoadedMessageSchema, type CutSpec, type PreviewSeekMessage } from "@zks/shared";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ICON_BUTTON_CLASS } from "../components/button-class.ts";
import { formatTimecode } from "../lib/format.ts";
import { editedDuration, editedToSource, sourceToEdited, type TimeSpan } from "./edl.ts";
import type { PlaybackClock } from "./playback-clock.ts";

/** Drift the proxy may have from the clock before it is re-seeked; smaller values stutter on slow decoders. */
const SEEK_TOLERANCE_S = 0.15;
/** A presented frame this close to a span's end is its last one, so the next frame comes from the other proxy. */
const SPAN_END_TOLERANCE_S = 0.02;

export interface PreviewComposition {
  readonly url: string;
  readonly edlVersion: number;
}

interface PreviewPlayerProps {
  readonly cuts: CutSpec | null;
  /** The kept source spans, in order: the edit the player shows. */
  readonly spans: readonly TimeSpan[];
  readonly composition: PreviewComposition | null;
  readonly clock: PlaybackClock;
  /** The video's 1080 H.264 proxy; the original may be HEVC, which Chrome cannot decode (plan §8.4). */
  readonly footageUrl: string | undefined;
}

const percentOf = (value: number, total: number) => `${(value / total) * 100}%`;
const covers = (span: TimeSpan, sourceS: number) => span.at <= sourceS && sourceS < span.end;

function spanIndexAt(spans: readonly TimeSpan[], sourceS: number): number {
  const index = spans.findIndex((span) => sourceS < span.end);
  return index === -1 ? spans.length - 1 : index;
}

/** The overlay page has an opaque origin (sandbox without allow-same-origin), so "*" is the only target that reaches it. */
function seekOverlay(overlay: HTMLIFrameElement | null, editedS: number): void {
  const message: PreviewSeekMessage = { type: PREVIEW_SEEK_MESSAGE, time: Math.max(0, editedS) };
  overlay?.contentWindow?.postMessage(message, "*");
}

/** Re-sends the current time once the frame has loaded, since seeks posted before its script ran were lost. */
function useOverlayLoadedSeek(overlayRef: React.RefObject<HTMLIFrameElement | null>, clock: PlaybackClock): void {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const overlayWindow = overlayRef.current?.contentWindow;
      if (overlayWindow == null || event.source !== overlayWindow) return;
      if (PreviewLoadedMessageSchema.safeParse(event.data).success) seekOverlay(overlayRef.current, clock.now());
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [overlayRef, clock]);
}

/**
 * Two proxies take turns: while one plays a kept span the other waits on the next span's first frame. The swap
 * happens on the playing proxy's last presented frame of its span (requestVideoFrameCallback), and that proxy leads
 * the clock, so the overlay follows the picture instead of the wall clock.
 */
export function PreviewPlayer({ cuts, spans, composition, clock, footageUrl }: PreviewPlayerProps) {
  const durationS = editedDuration(spans);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const firstVideoRef = useRef<HTMLVideoElement>(null);
  const secondVideoRef = useRef<HTMLVideoElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const punchFlagRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<HTMLIFrameElement>(null);
  const blurLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => clock.setDuration(durationS), [clock, durationS]);
  useOverlayLoadedSeek(overlayRef, clock);

  useEffect(() => {
    const videos = [firstVideoRef.current, secondVideoRef.current] as const;
    let activeSlot = 0;
    let activeSpanIndex = -1;
    let frameRequest: { readonly video: HTMLVideoElement; readonly handle: number } | null = null;
    const activeVideo = () => videos[activeSlot] ?? null;

    const cancelFrameRequest = () => {
      if (frameRequest !== null && "cancelVideoFrameCallback" in frameRequest.video) frameRequest.video.cancelVideoFrameCallback(frameRequest.handle);
      frameRequest = null;
    };
    const watchForSpanEnd = () => {
      cancelFrameRequest();
      const video = activeVideo();
      if (video === null || !clock.isPlaying() || !("requestVideoFrameCallback" in video)) return;
      const handle = video.requestVideoFrameCallback((_, metadata) => {
        frameRequest = null;
        const span = spans[activeSpanIndex];
        if (span !== undefined && metadata.mediaTime >= span.end - SPAN_END_TOLERANCE_S && activeSpanIndex + 1 < spans.length) swapTo(activeSpanIndex + 1);
        else watchForSpanEnd();
      });
      frameRequest = { video, handle };
    };

    const applyRoles = () => {
      const active = videos[activeSlot];
      const standby = videos[1 - activeSlot];
      if (active == null || standby == null) return;
      active.dataset.active = "true";
      active.muted = false;
      standby.dataset.active = "false";
      standby.muted = true;
      if (!standby.paused) standby.pause();
      if (!clock.isPlaying()) active.pause();
      else if (active.paused) active.play().catch(() => clock.pause());
      const nextSpan = spans[activeSpanIndex + 1];
      if (nextSpan !== undefined && Math.abs(standby.currentTime - nextSpan.at) > SEEK_TOLERANCE_S) standby.currentTime = nextSpan.at;
      watchForSpanEnd();
    };
    function swapTo(spanIndex: number): void {
      activeSlot = 1 - activeSlot;
      activeSpanIndex = spanIndex;
      applyRoles();
    }

    const syncToClock = (editedS: number) => {
      setIsPlaying(clock.isPlaying());
      if (timecodeRef.current !== null) timecodeRef.current.textContent = `${formatTimecode(editedS)} / ${formatTimecode(durationS)}`;
      seekOverlay(overlayRef.current, editedS);
      if (cuts === null || spans.length === 0) return;

      const sourceS = editedToSource(spans, editedS);
      const spanIndex = spanIndexAt(spans, sourceS);
      const isPlayingThroughSpan = spanIndex === activeSpanIndex && clock.isPlaying() && frameRequest !== null;
      // A browser without requestVideoFrameCallback swaps here, one clock tick late.
      if (spanIndex === activeSpanIndex + 1 && activeSpanIndex !== -1) swapTo(spanIndex);
      else if (!isPlayingThroughSpan) {
        activeSpanIndex = spanIndex;
        applyRoles();
      }
      const active = activeVideo();
      if (active !== null && Math.abs(active.currentTime - sourceS) > SEEK_TOLERANCE_S) active.currentTime = sourceS;

      const isPunchedIn = (cuts.zooms ?? []).some((zoom) => covers(zoom, sourceS));
      if (playerRef.current !== null) playerRef.current.dataset.punch = String(isPunchedIn);
      if (punchFlagRef.current !== null) punchFlagRef.current.hidden = !isPunchedIn;
      blurLayerRef.current?.querySelectorAll<HTMLElement>("[data-at]").forEach((box) => {
        box.hidden = !covers({ at: Number(box.dataset.at), end: Number(box.dataset.end) }, sourceS);
      });
    };

    clock.follow(() => {
      const active = activeVideo();
      return active === null || active.seeking || active.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ? null : sourceToEdited(spans, active.currentTime);
    });
    syncToClock(clock.now());
    const unsubscribe = clock.subscribe(syncToClock);
    return () => {
      unsubscribe();
      clock.follow(null);
      cancelFrameRequest();
    };
  }, [clock, cuts, spans, durationS]);

  const mediaUrl = cuts === null ? undefined : footageUrl;
  return (
    <div className="flex flex-col gap-3">
      <div ref={playerRef} className="player" data-punch="false">
        {mediaUrl !== undefined && (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions are drawn by the overlay iframe from the captions spec */}
            <video ref={firstVideoRef} className="player-layer footage" src={mediaUrl} preload="auto" playsInline data-active="true" />
            <video ref={secondVideoRef} className="player-layer footage" src={mediaUrl} preload="auto" playsInline muted data-active="false" />
          </>
        )}
        <div ref={blurLayerRef} className="player-layer pointer-events-none" aria-hidden="true">
          {(cuts?.blurBoxes ?? []).map((box) => (
            <div
              key={`${box.at}-${box.x}-${box.y}`}
              className="blur-box"
              data-at={box.at}
              data-end={box.end}
              hidden
              style={{
                left: percentOf(box.x, CANVAS.width),
                top: percentOf(box.y, CANVAS.height),
                width: percentOf(box.w, CANVAS.width),
                height: percentOf(box.h, CANVAS.height),
              }}
            />
          ))}
        </div>
        {composition !== null && (
          <iframe
            ref={overlayRef}
            className="player-layer pointer-events-none"
            title="Overlay preview"
            src={composition.url}
            sandbox="allow-scripts"
            data-edl-version={composition.edlVersion}
          />
        )}
        {cuts === null && (
          <div className="player-empty">
            <p>Add a clip to see it here.</p>
          </div>
        )}
      </div>
      <div className="transport">
        <button
          type="button"
          className={ICON_BUTTON_CLASS}
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={cuts === null}
          onClick={() => (clock.isPlaying() ? clock.pause() : clock.play())}
        >
          {isPlaying ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5" />}
        </button>
        <span ref={timecodeRef} className="timecode font-mono tabular-nums">
          {formatTimecode(0)} / {formatTimecode(durationS)}
        </span>
        <span ref={punchFlagRef} className="punch-flag font-mono" hidden>
          1.08× punch-in
        </span>
      </div>
    </div>
  );
}
