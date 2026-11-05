// Created by The Angelo Umali.
import { keptSpansOf, type Cue, type CutSpec } from "@zks/shared";
import type { TimeSpan } from "./edl.ts";

export const TRACK_IDS = ["video", "captions", "cues", "audio"] as const;
export type TrackId = (typeof TRACK_IDS)[number];
type BlockVariant = "seg" | "cut" | "punch" | "blur" | "frame" | "cap" | "cue" | "sfx" | "music";

/** One block on a lane, in source seconds: cuts stay visible as hatched gaps. */
export interface TimelineBlock extends TimeSpan {
  readonly id: string;
  readonly variant: BlockVariant;
  readonly label: string;
}

export type TimelineTracks = Readonly<Record<TrackId, readonly TimelineBlock[]>>;

const HEADLINE_FIELDS = ["text", "name", "title", "label", "cta"] as const;

function cueHeadline(cue: Cue): string | undefined {
  const fields: Readonly<Record<string, unknown>> = cue;
  for (const field of HEADLINE_FIELDS) {
    const value = fields[field];
    if (typeof value === "string") return value;
  }
  if (cue.kind === "hookTitle") return cue.lines[0];
  if (cue.kind === "pipeline") return cue.labels[0];
  return undefined;
}

function blocksFrom<Span extends TimeSpan>(spans: readonly Span[], variant: BlockVariant, labelOf: (span: Span) => string): TimelineBlock[] {
  return spans.map((span, position) => ({ id: `${variant}-${position}`, variant, at: span.at, end: span.end, label: labelOf(span) }));
}

/** `originalDurationS` draws the untouched clip as one block until a cut spec exists. */
export function buildTimelineTracks(cuts: CutSpec | null, cueSheet: readonly Cue[], originalDurationS = 0): TimelineTracks {
  const captionCues = cueSheet.filter((cue) => cue.kind === "caption");
  const otherCues = cueSheet.filter((cue) => cue.kind !== "caption");
  const captions = blocksFrom(captionCues, "cap", (cue) => cueHeadline(cue) ?? "");
  const cues = blocksFrom(otherCues, "cue", (cue) => {
    const headline = cueHeadline(cue);
    return headline === undefined ? cue.kind : `${cue.kind} · ${headline}`;
  });
  if (cuts === null) {
    const video = originalDurationS > 0 ? blocksFrom([{ at: 0, end: originalDurationS }], "seg", () => "Original") : [];
    return { video, captions, cues, audio: [] };
  }

  const video = [
    ...blocksFrom(keptSpansOf(cuts), "seg", () => ""),
    ...blocksFrom(cuts.removals, "cut", (removal) => removal.reason),
    ...blocksFrom(cuts.zooms ?? [], "punch", () => "1.08×"),
    ...blocksFrom(cuts.blurBoxes ?? [], "blur", () => ""),
    ...blocksFrom(cuts.reframes ?? [], "frame", () => "Reframe"),
    ...blocksFrom(cuts.focus ?? [], "frame", () => "Focus"),
  ];
  const audio = [...blocksFrom(cuts.bleeps ?? [], "sfx", () => "Bleep"), ...blocksFrom(musicSpans(cuts), "music", (span) => `Music · ${span.kind}`)];
  return { video, captions, cues, audio };
}

/** Each bed section runs until the next one starts, the last to the end of the source. */
function musicSpans(cuts: CutSpec): (TimeSpan & { readonly kind: string })[] {
  const sections = cuts.music?.sections ?? [];
  return sections.map((section, index) => ({ at: section.at, end: sections[index + 1]?.at ?? cuts.durationS, kind: section.kind }));
}
