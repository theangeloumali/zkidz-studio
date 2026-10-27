// Created by The Angelo Umali.
import { screen } from "@testing-library/react";
import type { Cue } from "@zks/shared";
import { editedDuration, type TimeSpan } from "../src/editor/edl.ts";
import { createPlaybackClock } from "../src/editor/playback-clock.ts";
import { Timeline } from "../src/editor/timeline.tsx";
import { buildTimelineTracks } from "../src/editor/timeline-items.ts";
import { renderWithProviders } from "./render.tsx";

export const BULK_DURATION_S = 600;
/** The e2e bulk fixture (harness/serve.ts): 2,000 cues 0.3 s apart, each 80% of its slot. */
export const bulkCues = Array.from({ length: 2000 }, (_, index): Cue => {
  const at = (index * BULK_DURATION_S) / 2000;
  return { kind: "keyword", at, end: at + 0.24, text: `Cue ${index}` };
});

export function renderTimeline(cueSheet: readonly Cue[], durationS: number, keptSpans: readonly TimeSpan[] = [{ at: 0, end: durationS }]) {
  const clock = createPlaybackClock({ durationS: editedDuration(keptSpans) });
  const view = renderWithProviders(
    <Timeline tracks={buildTimelineTracks(null, [...cueSheet])} sourceDurationS={durationS} keptSpans={keptSpans} clock={clock} />,
  );
  const scroller = view.container.querySelector<HTMLElement>(".timeline-scroll");
  if (scroller === null) throw new Error("no timeline scroller");
  return { clock, scroller, nodeCount: () => scroller.querySelectorAll("*").length };
}

export const zoomButton = (name: "Zoom in" | "Zoom out" | "Fit") => screen.getByRole("button", { name });
