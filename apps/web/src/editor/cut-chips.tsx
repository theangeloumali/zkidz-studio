// Created by The Angelo Umali.
import { Check, X } from "lucide-react";
import type { EventOf } from "../agent/feed-notes.ts";
import { use } from "react";
import { formatDuration } from "../lib/format.ts";
import { PixelsPerSecondContext } from "./timeline.tsx";

export type CutDecision = "approved" | "rejected";
type Candidate = EventOf<"cuts.proposed">["candidates"][number];

interface CutChipsProps {
  readonly candidates: readonly Candidate[];
  readonly decisions: Readonly<Record<string, CutDecision>>;
  readonly onDecide: (candidateId: string, decision: CutDecision) => void;
}

/** One chip per proposed cut, sitting on the video lane where it would cut. */
export function CutChips({ candidates, decisions, onDecide }: CutChipsProps) {
  const pixelsPerSecond = use(PixelsPerSecondContext);
  return candidates.map((candidate) => {
    const span = `${formatDuration(candidate.at)}–${formatDuration(candidate.end)}`;
    const decision = decisions[candidate.id];
    return (
      <li
        key={candidate.id}
        className="cut-chip"
        data-decision={decision ?? "pending"}
        title={`${candidate.reason}: “${candidate.context}”`}
        style={{ left: candidate.at * pixelsPerSecond, width: (candidate.end - candidate.at) * pixelsPerSecond }}
      >
        <button
          type="button"
          className="chip-toggle"
          aria-pressed={decision === "approved"}
          aria-label={`Approve cut ${span}`}
          onClick={() => onDecide(candidate.id, "approved")}
        >
          <Check aria-hidden="true" className="size-3.5" />
        </button>
        <button
          type="button"
          className="chip-toggle"
          aria-pressed={decision === "rejected"}
          aria-label={`Reject cut ${span}`}
          onClick={() => onDecide(candidate.id, "rejected")}
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </li>
    );
  });
}
