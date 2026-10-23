// Created by The Angelo Umali.
import { describe, expect, it, vi } from "vitest";
import { createPlaybackClock } from "../src/editor/playback-clock.ts";

function manualTime() {
  let nowMs = 0;
  const frames: FrameRequestCallback[] = [];
  return {
    now: () => nowMs,
    requestFrame: (callback: FrameRequestCallback) => frames.push(callback),
    cancelFrame: () => frames.splice(0),
    advance(ms: number) {
      nowMs += ms;
      frames.splice(0).forEach((callback) => callback(nowMs));
    },
  };
}

describe("createPlaybackClock", () => {
  it("advances with wall time only while playing and stops at the end", () => {
    const time = manualTime();
    const clock = createPlaybackClock({ durationS: 2, ...time });
    clock.play();
    time.advance(500);
    expect(clock.now()).toBeCloseTo(0.5);
    clock.pause();
    time.advance(500);
    expect(clock.now()).toBeCloseTo(0.5);
    clock.play();
    time.advance(5000);
    expect(clock.now()).toBe(2);
    expect(clock.isPlaying()).toBe(false);
  });

  it("tells listeners about every frame and seek", () => {
    const time = manualTime();
    const clock = createPlaybackClock({ durationS: 10, ...time });
    const listener = vi.fn();
    const unsubscribe = clock.subscribe(listener);
    clock.seek(4);
    expect(listener).toHaveBeenLastCalledWith(4);
    clock.play();
    time.advance(1000);
    expect(listener).toHaveBeenLastCalledWith(5);
    unsubscribe();
    clock.seek(1);
    expect(listener).toHaveBeenLastCalledWith(5);
  });

  it("takes its time from the followed media while playing, and wall time while the media cannot say", () => {
    const time = manualTime();
    const clock = createPlaybackClock({ durationS: 10, ...time });
    let mediaS: number | null = 3;
    clock.follow(() => mediaS);
    clock.play();
    time.advance(100);
    expect(clock.now()).toBe(3);
    mediaS = null;
    time.advance(500);
    expect(clock.now()).toBeCloseTo(3.5);
  });

  it("ignores the followed media while paused", () => {
    const time = manualTime();
    const clock = createPlaybackClock({ durationS: 10, ...time });
    clock.follow(() => 7);
    clock.seek(2);
    expect(clock.now()).toBe(2);
  });

  it("restarts from the top when played at the end, seeking the followed media there first", () => {
    const time = manualTime();
    const clock = createPlaybackClock({ durationS: 26, ...time });
    let mediaS: number | null = 26;
    clock.follow(() => mediaS);
    // The player seeks its media on every notify, as preview-player's syncToClock does.
    clock.subscribe((editedS) => (mediaS = editedS));
    clock.seek(26);
    clock.play();
    expect(mediaS).toBe(0);
    time.advance(16);
    expect(clock.isPlaying()).toBe(true);
    expect(clock.now()).toBe(0);
  });
});
