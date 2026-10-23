// Created by The Angelo Umali.
import { buttonClass } from "../components/button-class.ts";
import { CardShell } from "./card-shell.tsx";
import { DecisionFooter } from "./decision-footer.tsx";
import type { EventOf } from "./feed-notes.ts";
import { useDecision } from "./use-decision.ts";

type Facts = EventOf<"approval.requested">["facts"];

function factRows(facts: Facts, tool: string): [string, string][] {
  const rows: [string, string][] = [["Tool", tool]];
  if (facts.target) rows.push(["Video", facts.target]);
  if (facts.quality) rows.push(["Quality", facts.quality]);
  if (facts.estimatedGpuMinutes !== undefined) rows.push(["GPU time", `about ${Math.round(facts.estimatedGpuMinutes)} GPU minutes`]);
  rows.push(["Writes", facts.outputPaths.length > 0 ? facts.outputPaths.join(", ") : "Nothing"]);
  if (facts.filesToDelete.length > 0) rows.push(["Deletes", facts.filesToDelete.join(", ")]);
  return rows;
}

/** The server's facts come first; Claude's note is quoted after them because the agent can be wrong about what it asks for. */
export function ApprovalCard({ projectId, event }: { readonly projectId: string; readonly event: EventOf<"approval.requested"> }) {
  const decision = useDecision(projectId);
  const send = (choice: "allow" | "deny") => decision.mutate({ kind: "approval", requestId: event.requestId, decision: choice });
  return (
    <CardShell eyebrow="Needs your OK" title={event.facts.action}>
      <ul aria-label="What will happen" className="flex flex-col gap-1">
        {factRows(event.facts, event.tool).map(([label, value]) => (
          <li key={label} className={`flex gap-3 text-ui ${label === "Deletes" ? "text-danger" : "text-copy"}`}>
            <span className="w-20 shrink-0 font-semibold text-copy-muted">{label}</span>
            <span className="min-w-0 font-mono text-ui-sm break-all">{value}</span>
          </li>
        ))}
      </ul>
      {event.agentNote ? (
        <figure className="flex flex-col gap-1 border-l-2 border-line-strong pl-3">
          <figcaption className="text-ui-sm font-semibold text-copy-muted">Claude says</figcaption>
          <blockquote className="text-ui break-words text-copy-muted">{event.agentNote}</blockquote>
        </figure>
      ) : null}
      <DecisionFooter decision={decision}>
        <button type="button" className={buttonClass("primary")} disabled={decision.isPending} onClick={() => send("allow")}>
          Approve
        </button>
        <button type="button" className={buttonClass("secondary")} disabled={decision.isPending} onClick={() => send("deny")}>
          Not yet
        </button>
      </DecisionFooter>
    </CardShell>
  );
}
