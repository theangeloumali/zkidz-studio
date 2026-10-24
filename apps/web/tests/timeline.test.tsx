// Created by The Angelo Umali.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import type { Cue } from "@zks/shared";
import { describe, expect, it, vi } from "vitest";
import { editedDuration, type TimeSpan } from "../src/editor/edl.ts";
import { createPlaybackClock } from "../src/editor/playback-clock.ts";
import { Timeline } from "../src/editor/timeline.tsx";
import { buildTimelineTracks } from "../src/editor/timeline-items.ts";
import { renderWithProviders } from "./render.tsx";

const NODE_CAP = 600;
// The test bounds DOM nodes, not speed; re-rendering 2,000 cues overran waitFor's 1 s default at load 25+ in ci:local.
const BULK_RERENDER_TIMEOUT_MS = 5_000;
const BULK_DURATION_S = 600;
/** The e2e bulk fixture (harness/serve.ts): 2,000 cues 0.3 s apart, each 80% of its slot. */
const bulkCues = Array.from({ length: 2000 }, (_, index): Cue => {
  const at = (index * BULK_DURATION_S) / 2000;
  return { kind: "keyword", at, end: at + 0.24, text: `Cue ${index}` };
});

function renderTimeline(cueSheet: readonly Cue[], durationS: number, keptSpans: readonly TimeSpan[] = [{ at: 0, end: durationS }]) {
  const clock = createPlaybackClock({ durationS: editedDuration(keptSpans) });
  const view = renderWithProviders(
    <Timeline tracks={buildTimelineTracks(null, [...cueSheet])} sourceDurationS={durationS} keptSpans={keptSpans} clock={clock} />,
  );
  const scroller = view.container.querySelector<HTMLElement>(".timeline-scroll");
  if (scroller === null) throw new Error("no timeline scroller");
  return { clock, scroller, nodeCount: () => scroller.querySelectorAll("*").length };
}

const zoomButton = (name: "Zoom in" | "Zoom out" | "Fit") => screen.getByRole("button", { name });

describe("Timeline windowing", () => {
  it("keeps 2,000 blocks out of the DOM except the ones near the viewport", () => {
    const cueSheet = Array.from({ length: 2000 }, (_, index): Cue => ({ kind: "keyword", at: index * 2, end: index * 2 + 1.5, text: `Cue ${index}` }));
    renderTimeline(cueSheet, 4000);

    const renderedCues = within(screen.getByTestId("lane-cues")).getAllByRole("listitem");
    expect(renderedCues.length).toBeGreaterThan(5);
    expect(renderedCues.length).toBeLessThan(40);
  });

  it("draws cues too thin to see at this scale as one run named for what it holds", () => {
    // 1.2 px wide and 0.8 px apart at 40 px/s: under the 2 px floor for both.
    const cueSheet = Array.from({ length: 50 }, (_, index): Cue => ({
      kind: "keyword",
      at: 2 + index * 0.05,
      end: 2 + index * 0.05 + 0.03,
      text: `Tick ${index}`,
    }));
    renderTimeline(cueSheet, 30);

    const lane = within(screen.getByTestId("lane-cues"));
    expect(lane.getAllByRole("listitem")).toHaveLength(1);
    expect(lane.getByRole("listitem", { name: "50 cues, 0:02–0:04" })).toHaveAttribute("title", "50 cues, 0:02–0:04");
  });

  it("stays under 600 DOM nodes on the 2,000-cue fixture at 40 px/s, mid-scroll, and at Fit", async () => {
    const { scroller, nodeCount } = renderTimeline(bulkCues, BULK_DURATION_S);
    expect(nodeCount()).toBeLessThanOrEqual(NODE_CAP);

    scroller.scrollLeft = 12_000;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(within(screen.getByTestId("lane-cues")).getByRole("listitem", { name: /Cue 1000$/ })).toBeInTheDocument(), {
      timeout: BULK_RERENDER_TIMEOUT_MS,
    });
    expect(nodeCount()).toBeLessThanOrEqual(NODE_CAP);

    await userEvent.click(zoomButton("Fit"));
    expect(within(screen.getByTestId("lane-cues")).getByRole("listitem", { name: /^2000 cues, 0:00–/ })).toBeInTheDocument();
    expect(nodeCount()).toBeLessThanOrEqual(NODE_CAP);
  });
});

describe("Timeline level of detail", () => {
  it("shows a label from 48 px wide, keeps it in the name below that, and draws slivers without ring or radius", () => {
    // At 40 px/s: 2 s is 80 px, 0.5 s is 20 px, 0.1 s is 4 px.
    renderTimeline(
      [
        { kind: "keyword", at: 1, end: 3, text: "Wide" },
        { kind: "keyword", at: 5, end: 5.5, text: "Narrow" },
        { kind: "keyword", at: 8, end: 8.1, text: "Sliver" },
      ],
      30,
    );
    const lane = within(screen.getByTestId("lane-cues"));

    expect(lane.getByRole("listitem", { name: /Wide$/ })).toHaveTextContent("Wide");
    const narrow = lane.getByRole("listitem", { name: /Narrow$/ });
    expect(narrow).toBeEmptyDOMElement();
    expect(narrow).toHaveAttribute("title", "keyword · Narrow");
    expect(lane.getByRole("listitem", { name: /Sliver$/ })).toHaveClass("blk-sliver");
  });
});

describe("Timeline accessibility", () => {
  it("has no axe violations on the 2,000-cue fixture at 40 px/s or at Fit", async () => {
    const { scroller } = renderTimeline(bulkCues, BULK_DURATION_S);
    const violations = async () =>
      (await axe.run(scroller.parentElement ?? scroller, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } })).violations.map(
        (violation) => `${violation.id}: ${violation.help}`,
      );
    expect(await violations()).toEqual([]);

    await userEvent.click(zoomButton("Fit"));
    expect(await violations()).toEqual([]);
  });
});

describe("Timeline lanes", () => {
  it("names each lane as a group with its item count, and shows the count beside the track label", () => {
    renderTimeline(bulkCues.slice(0, 412), BULK_DURATION_S);

    expect(screen.getByRole("group", { name: "Cues, 412 items" })).toHaveTextContent(/Cues\s*412/);
    expect(screen.getByRole("group", { name: "Captions, no items" })).toBeInTheDocument();
  });

  it("says item, not items, for a lane holding one", () => {
    renderTimeline(bulkCues.slice(0, 1), BULK_DURATION_S);

    expect(screen.getByRole("group", { name: "Cues, 1 item" })).toBeInTheDocument();
  });
});

describe("Timeline zoom", () => {
  it("starts at 40 px/s with only Zoom in disabled, and Fit disables Zoom out and Fit", async () => {
    renderTimeline(bulkCues, BULK_DURATION_S);
    expect(zoomButton("Zoom in")).toBeDisabled();
    expect(zoomButton("Zoom out")).toBeEnabled();

    await userEvent.click(zoomButton("Fit"));

    expect(zoomButton("Zoom out")).toBeDisabled();
    expect(zoomButton("Fit")).toBeDisabled();
    expect(zoomButton("Zoom in")).toBeEnabled();
  });

  it("steps ÷2 and ×2 with the buttons", async () => {
    renderTimeline(bulkCues, BULK_DURATION_S);
    const timeline = () => document.querySelector<HTMLElement>(".timeline");
    const widthAt40 = timeline()?.style.width;

    await userEvent.click(zoomButton("Zoom out"));
    expect(timeline()?.style.width).toBe(`${104 + BULK_DURATION_S * 20}px`);
    await userEvent.click(zoomButton("Zoom in"));
    expect(timeline()?.style.width).toBe(widthAt40);
  });

  it("zooms with Ctrl + wheel, once per animation frame, and ignores a plain wheel", async () => {
    const { scroller } = renderTimeline(bulkCues, BULK_DURATION_S);

    fireEvent.wheel(scroller, { deltaY: 300 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(zoomButton("Zoom in")).toBeDisabled();

    fireEvent.wheel(scroller, { deltaY: 300, ctrlKey: true });
    fireEvent.wheel(scroller, { deltaY: 300, ctrlKey: true });
    await waitFor(() => expect(zoomButton("Zoom in")).toBeEnabled());
  });

  it("disables every zoom control with no media", () => {
    renderTimeline([], 0);

    expect(zoomButton("Zoom in")).toBeDisabled();
    expect(zoomButton("Zoom out")).toBeDisabled();
    expect(zoomButton("Fit")).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Playhead" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Timeline keyboard seek", () => {
  it("is one Playhead slider that seeks ±1 s, ±10 s with Shift, and Home / End to the ends", () => {
    const { clock } = renderTimeline(bulkCues, BULK_DURATION_S);
    const slider = screen.getByRole("slider", { name: "Playhead" });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", String(BULK_DURATION_S));
    expect(slider).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(clock.now()).toBe(1);
    expect(slider).toHaveAttribute("aria-valuetext", "0:01.0 of 10:00.0");
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(clock.now()).toBe(11);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(clock.now()).toBe(10);
    fireEvent.keyDown(slider, { key: "End" });
    expect(clock.now()).toBe(BULK_DURATION_S);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(clock.now()).toBe(0);
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(clock.now()).toBe(0);
  });

  it("zooms with - and + while focused", () => {
    renderTimeline(bulkCues, BULK_DURATION_S);
    const slider = screen.getByRole("slider", { name: "Playhead" });

    fireEvent.keyDown(slider, { key: "-" });
    expect(zoomButton("Zoom in")).toBeEnabled();
    fireEvent.keyDown(slider, { key: "+" });
    expect(zoomButton("Zoom in")).toBeDisabled();
  });

  it("jumps one viewport forward when the playing playhead leaves the view, with the label column kept clear", () => {
    const { clock, scroller } = renderTimeline(bulkCues, BULK_DURATION_S);
    clock.play();
    clock.seek(40);
    clock.pause();

    expect(scroller.scrollLeft).toBe(1280 - 104);
  });

  it("does not make blocks tab stops", () => {
    renderTimeline(bulkCues, BULK_DURATION_S);

    expect(within(screen.getByTestId("lane-cues")).getAllByRole("listitem")[0]).not.toHaveAttribute("tabindex");
  });
});

describe("Timeline click-to-seek", () => {
  /** jsdom lays nothing out: the ruler (source 0 s) sits after the 104 px label column. */
  const RULER_LEFT_PX = 104;
  const PPS = 40;
  const atSourceS = (sourceS: number) => ({ clientX: RULER_LEFT_PX + sourceS * PPS, button: 0, pointerId: 1 });

  function renderWithRuler(keptSpans?: readonly TimeSpan[]) {
    const rendered = renderTimeline([{ kind: "keyword", at: 2, end: 4, text: "Block" }], 30, keptSpans);
    const slider = screen.getByRole("slider", { name: "Playhead" });
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue(new DOMRect(RULER_LEFT_PX, 0, 30 * PPS, 20));
    return { ...rendered, slider };
  }

  it("moves the playhead to the clicked ruler time, in edited seconds, and updates the slider", () => {
    const { clock, slider } = renderWithRuler([
      { at: 0, end: 5 },
      { at: 8, end: 30 },
    ]);

    fireEvent.pointerDown(slider, atSourceS(10));
    fireEvent.pointerUp(window, atSourceS(10));

    expect(clock.now()).toBe(7);
    expect(slider).toHaveAttribute("aria-valuenow", "7");
  });

  it("seeks from a press on the empty lane area, but not from a block or the label column", () => {
    const { clock } = renderWithRuler();
    const lane = screen.getByTestId("lane-video");

    fireEvent.pointerDown(within(screen.getByTestId("lane-cues")).getByRole("listitem"), atSourceS(3));
    fireEvent.pointerUp(window, atSourceS(3));
    expect(clock.now()).toBe(0);
    fireEvent.pointerDown(screen.getByText("Video"), atSourceS(5));
    fireEvent.pointerUp(window, atSourceS(5));
    expect(clock.now()).toBe(0);

    fireEvent.pointerDown(lane, atSourceS(12.5));
    fireEvent.pointerUp(window, atSourceS(12.5));
    expect(clock.now()).toBe(12.5);
  });

  it("scrubs while dragged, seeking at most once per animation frame", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    const { clock, slider } = renderWithRuler();
    const seek = vi.spyOn(clock, "seek");

    fireEvent.pointerDown(slider, atSourceS(1));
    fireEvent.pointerMove(window, atSourceS(2));
    fireEvent.pointerMove(window, atSourceS(3));
    fireEvent.pointerMove(window, atSourceS(4));
    expect(seek).toHaveBeenCalledTimes(1);

    for (const frame of frames.splice(0)) frame(0);
    expect(seek).toHaveBeenCalledTimes(2);
    expect(clock.now()).toBe(4);

    fireEvent.pointerUp(window, atSourceS(6));
    expect(clock.now()).toBe(6);
    fireEvent.pointerMove(window, atSourceS(9));
    for (const frame of frames.splice(0)) frame(0);
    expect(clock.now()).toBe(6);
  });
});
