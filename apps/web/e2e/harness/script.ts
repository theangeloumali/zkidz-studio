// Created by The Angelo Umali.
// What the harness and the specs agree on: the seeded versions, the replay length and the hostile and bulk cues.
export const REPLAY_CALL_COUNT = 40;
export const CUE_CALL_TEXT = "Replay cue";
/** Markup an agent might slip into cue text; the preview must show it as text, never parse it. */
export const HOSTILE_CUE_TEXT = "</script><img src=x onerror=alert(1)>";
/** The timeline budget is checked against this many cue blocks (plan §9.2). */
export const TIMELINE_ITEM_COUNT = 2_000;

/** v1 keeps everything, v2 drops 1 s, v3 drops 4 s, so each version has its own edited length. */
export const SEEDED_REMOVALS = [[], [{ at: 5, end: 6, reason: "seed" }], [{ at: 10, end: 14, reason: "seed" }]];

// The cut-tools test's words: one filler, one stutter and one pause candidate.
export const STUTTER_WORDS = [
  { at: 0, end: 0.4, text: "So" },
  { at: 0.5, end: 0.8, text: "um" },
  { at: 1, end: 1.3, text: "today" },
  { at: 3, end: 3.3, text: "we" },
  { at: 3.4, end: 3.6, text: "we" },
  { at: 3.7, end: 4, text: "edit" },
];

export interface HarnessProject {
  readonly projectId: string;
  readonly videoId: string;
  readonly replayCallCount: number;
  /** A second project carrying TIMELINE_ITEM_COUNT cues, for the frame budget. */
  readonly bulkProjectId: string;
}
