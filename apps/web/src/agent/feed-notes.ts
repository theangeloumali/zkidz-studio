// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";

export type EventOf<Type extends StudioEvent["type"]> = Extract<StudioEvent, { type: Type }>;
export interface FeedNote {
  readonly tone: "info" | "warn";
  readonly text: string;
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatEta(etaS: number): string {
  return etaS < 60 ? `about ${Math.round(etaS)} s left` : `about ${Math.round(etaS / 60)} min left`;
}

/** A short render rounds to 0 minutes, which reads as free; below one it says so. */
export function formatGpuMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 1) return "under 1 GPU minute";
  return `about ${rounded} GPU ${rounded === 1 ? "minute" : "minutes"}`;
}

function describeLimit(event: EventOf<"limit">): string | null {
  if (event.status === "rejected") return event.resetsAt ? `Plan limit reached. Resets at ${formatClock(event.resetsAt)}.` : "Plan limit reached.";
  if (event.status === "allowed_warning") {
    return event.utilization === undefined ? "Close to your plan limit." : `Close to your plan limit (${Math.round(event.utilization * 100)}% used).`;
  }
  return null;
}

function describeTurn(event: EventOf<"turn.completed">): string {
  if (event.isError) return `Turn stopped (${event.subtype}) after ${event.numTurns} steps.`;
  return `Turn finished: ${event.numTurns} steps in ${Math.round(event.durationMs / 1000)} s.`;
}

const TERMINAL_TEXT = {
  starting: "Claude Code is starting.",
  ready: "Claude Code is ready.",
  working: "Claude Code is working.",
  waiting: "Claude Code is waiting for you.",
} as const;

function describeTerminal(event: EventOf<"terminal.state">): string {
  if (event.state !== "exited") return TERMINAL_TEXT[event.state];
  return event.exitCode === undefined ? "Claude Code exited." : `Claude Code exited (code ${event.exitCode}).`;
}

/** One-line events: the note to show, or null for events the feed folds or draws as cards. */
export function describeNote(event: StudioEvent): FeedNote | null {
  switch (event.type) {
    case "session.started":
      return { tone: "info", text: `Session started with ${event.model} · ${event.credential}` };
    case "tool.denied":
      return { tone: "warn", text: `Blocked ${event.name}: ${event.reason}` };
    case "spec.version":
      return { tone: "info", text: `Saved ${event.kind} v${event.version} for ${event.videoId} (${event.author})${event.note ? `: ${event.note}` : ""}` };
    case "preview.ready":
      return { tone: "info", text: `Preview ready for ${event.videoId} (edit v${event.edlVersion})` };
    case "retry":
      return { tone: "warn", text: `Retrying in ${Math.round(event.delayMs / 1000)} s (attempt ${event.attempt} of ${event.max}): ${event.reason}` };
    case "limit": {
      const text = describeLimit(event);
      return text === null ? { tone: "info", text: "Plan usage is within limits." } : { tone: "warn", text };
    }
    case "turn.completed":
      return { tone: event.isError ? "warn" : "info", text: describeTurn(event) };
    case "context.compacted":
      return { tone: "info", text: "Older conversation was summarized to make room." };
    case "terminal.state":
      return { tone: event.state === "exited" ? "warn" : "info", text: describeTerminal(event) };
    default:
      return null;
  }
}
