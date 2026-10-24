// Created by The Angelo Umali.
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { decideCutCandidates } from "../api/client.ts";
import { buttonClass } from "../components/button-class.ts";
import { formatTimecode } from "../lib/format.ts";
import { CardShell } from "./card-shell.tsx";
import { DecisionFooter } from "./decision-footer.tsx";
import type { EventOf } from "./feed-notes.ts";

export function CutsCard({ projectId, event }: { readonly projectId: string; readonly event: EventOf<"cuts.proposed"> }) {
  // The cut reviewer waits on this route, not on /decisions.
  const decision = useMutation({
    mutationFn: (approved: string[]) => decideCutCandidates(projectId, event.requestId, { approved, rejected: [...rejected] }),
  });
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string, isKept: boolean) =>
    setRejected((current) => {
      const next = new Set(current);
      if (isKept) next.delete(id);
      else next.add(id);
      return next;
    });
  const ids = event.candidates.map((candidate) => candidate.id);

  return (
    <CardShell eyebrow="Proposed cuts" title={`${event.candidates.length} cuts to review`}>
      <ul className="flex flex-col gap-2">
        {event.candidates.map((candidate) => (
          <li key={candidate.id}>
            <label className="flex min-h-(--target-min) cursor-pointer items-start gap-3 text-ui text-copy">
              <input
                type="checkbox"
                checked={!rejected.has(candidate.id)}
                onChange={(changeEvent) => toggle(candidate.id, changeEvent.currentTarget.checked)}
                className="mt-1 size-5 shrink-0 accent-accent"
              />
              <span className="min-w-0 break-words">
                <span className="font-mono text-ui-sm text-copy-muted tabular-nums">
                  {formatTimecode(candidate.at)}–{formatTimecode(candidate.end)}
                </span>{" "}
                <q>{candidate.context}</q>
                <span className="block text-ui-sm text-copy-muted">{candidate.reason}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <DecisionFooter decision={decision}>
        <button
          type="button"
          className={buttonClass("primary")}
          disabled={decision.isPending}
          onClick={() => decision.mutate(ids.filter((id) => !rejected.has(id)))}
        >
          Apply cuts
        </button>
      </DecisionFooter>
    </CardShell>
  );
}
