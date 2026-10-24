// Created by The Angelo Umali.
import { AudioLines, Film, Layers, Type, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { formatDuration } from "../lib/format.ts";
import { isDensityRun, isMark, type DrawnBlock } from "./timeline-density.ts";
import type { TrackId } from "./timeline-items.ts";
import { blockLod } from "./timeline-scale.ts";

export const TRACK_META: Record<TrackId, { readonly label: string; readonly itemNoun: string; readonly Icon: LucideIcon }> = {
  video: { label: "Video", itemNoun: "edits", Icon: Film },
  captions: { label: "Captions", itemNoun: "captions", Icon: Type },
  cues: { label: "Cues", itemNoun: "cues", Icon: Layers },
  audio: { label: "Audio", itemNoun: "sound effects", Icon: AudioLines },
};

/** One element per block: its name sits in `aria-label`, not a child span, to keep the lane under the node cap. */
function LaneBlock({ block, pixelsPerSecond }: { readonly block: DrawnBlock; readonly pixelsPerSecond: number }) {
  const widthPx = (block.end - block.at) * pixelsPerSecond;
  const lod = blockLod(widthPx);
  const run = isDensityRun(block);
  const name = run ? block.label : `${block.variant} ${formatDuration(block.at)}–${formatDuration(block.end)} ${block.label}`.trim();
  const classes = ["blk", `blk-${block.variant}`, run && !isMark(block) && "blk-run", lod === "sliver" && "blk-sliver"];
  const left = block.at * pixelsPerSecond;
  return (
    <li
      className={classes.filter(Boolean).join(" ")}
      style={block.variant === "sfx" ? { left } : { left, width: Math.max(2, widthPx) }}
      title={block.label || undefined}
      aria-label={name}
    >
      {lod === "label" && !isMark(block) ? block.label : null}
    </li>
  );
}

const itemCountText = (count: number) => (count === 0 ? "no items" : count === 1 ? "1 item" : `${count} items`);

interface TimelineLaneProps {
  readonly trackId: TrackId;
  readonly blocks: readonly DrawnBlock[];
  readonly itemCount: number;
  readonly pixelsPerSecond: number;
  readonly children?: ReactNode;
}

/** A named group (spec §7) whose label counts what the lane holds, so a lane of runs still says what is in it. */
export function TimelineLane({ trackId, blocks, itemCount, pixelsPerSecond, children }: TimelineLaneProps) {
  const { label, Icon } = TRACK_META[trackId];
  return (
    <div className="track" data-track={trackId} role="group" aria-label={`${label}, ${itemCountText(itemCount)}`}>
      <span className="track-label" id={`track-${trackId}`}>
        <Icon aria-hidden="true" className="size-3.5 text-copy-dim" />
        {label}
        {itemCount > 0 && <span className="font-mono text-copy-dim tabular-nums">{itemCount}</span>}
      </span>
      <ul className="track-lane" aria-labelledby={`track-${trackId}`} data-testid={`lane-${trackId}`}>
        {blocks.map((block) => (
          <LaneBlock key={block.id} block={block} pixelsPerSecond={pixelsPerSecond} />
        ))}
        {children}
      </ul>
    </div>
  );
}
