// Created by The Angelo Umali.
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BULK_DURATION_S, bulkCues, renderTimeline } from "./timeline-fixture.tsx";

const ZOOM_SETTLE_MS = 150;

let frames: FrameRequestCallback[] = [];
const runFrames = () => act(() => frames.splice(0).forEach((callback) => callback(0)));
const settle = () =>
  act(() => {
    vi.advanceTimersByTime(ZOOM_SETTLE_MS);
  });
const mountedCues = () => within(screen.getByTestId("lane-cues")).getAllByRole("listitem").length;

/** The bulk timeline at 40 px/s, scrolled to its middle, with one viewport of margin mounted each side. */
function renderScrolled() {
  const rendered = renderTimeline(bulkCues, BULK_DURATION_S);
  runFrames();
  rendered.scroller.scrollLeft = 12_000;
  fireEvent.scroll(rendered.scroller);
  runFrames();
  return rendered;
}

function wheelZoomOut(scroller: HTMLElement) {
  fireEvent.wheel(scroller, { deltaY: 300, ctrlKey: true, clientX: 640 });
  runFrames();
}

beforeEach(() => {
  frames = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
});

describe("Timeline wheel zoom window", () => {
  it("mounts only the viewport while a Ctrl + wheel zoom runs, through its own scroll, and the margins once it settles", () => {
    const { scroller } = renderScrolled();

    wheelZoomOut(scroller);
    const duringZoom = mountedCues();
    fireEvent.scroll(scroller);
    runFrames();
    expect(mountedCues()).toBe(duringZoom);

    settle();
    expect(mountedCues()).toBeGreaterThan(duringZoom * 1.5);
  });

  it("brings the margins back as soon as the view scrolls by something other than the zoom", () => {
    const { scroller } = renderScrolled();
    wheelZoomOut(scroller);

    scroller.scrollLeft += 2_000;
    fireEvent.scroll(scroller);
    runFrames();
    const afterScroll = mountedCues();
    settle();
    expect(mountedCues()).toBe(afterScroll);
  });

  it("brings the margins back for a key zoom right after a wheel zoom", () => {
    const { scroller } = renderScrolled();
    wheelZoomOut(scroller);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Playhead" }), { key: "-" });
    const afterKeyZoom = mountedCues();
    settle();
    expect(mountedCues()).toBe(afterKeyZoom);
  });

  it("keeps the margins for a Ctrl + wheel past the zoom limit", () => {
    const { scroller } = renderScrolled();
    const atLimit = mountedCues();

    fireEvent.wheel(scroller, { deltaY: -300, ctrlKey: true, clientX: 640 });
    runFrames();
    expect(mountedCues()).toBe(atLimit);
  });

  it("leaves a later scroll where it is after a zoom request at the limit", () => {
    const { scroller } = renderScrolled();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Playhead" }), { key: "+" });

    scroller.scrollLeft = 20_000;
    fireEvent.scroll(scroller);
    runFrames();
    // A narrower pane changes Fit, which re-runs the layout effect that applies a pending zoom scroll.
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 1_000 });
    fireEvent(window, new Event("resize"));
    runFrames();
    expect(scroller.scrollLeft).toBe(20_000);
  });
});
