// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";
import { describeNote, formatEta, type EventOf, type FeedNote } from "./feed-notes.ts";

type CardEvent = EventOf<"question.asked" | "approval.requested" | "cuts.proposed" | "session.error">;
type ToolEvent = EventOf<"tool.started" | "tool.called" | "tool.finished" | "tool.heartbeat">;
type JobEvent = EventOf<"job.queued" | "job.started" | "job.finished" | "job.progress">;

export interface ToolItem {
  readonly kind: "tool";
  readonly key: string;
  readonly name: string;
  readonly label: string;
  readonly state: "running" | "ok" | "failed";
  readonly summary: string;
  readonly elapsedS: number | null;
}

export interface JobItem {
  readonly kind: "job";
  readonly key: string;
  readonly jobKind: string;
  readonly status: string;
  readonly progress: string | null;
}

/** What the activity feed draws; strings here are rendered as text nodes only. */
export type FeedItem =
  | { readonly kind: "prompt" | "agent"; readonly key: string; readonly text: string }
  | ToolItem
  | JobItem
  | { readonly kind: "approval"; readonly key: string; readonly event: EventOf<"approval.requested"> }
  | { readonly kind: "question"; readonly key: string; readonly event: EventOf<"question.asked"> }
  | { readonly kind: "cuts"; readonly key: string; readonly event: EventOf<"cuts.proposed"> }
  | { readonly kind: "error"; readonly key: string; readonly event: EventOf<"session.error"> }
  | ({ readonly kind: "note"; readonly key: string } & FeedNote);

function cardItem(event: CardEvent, key: string): FeedItem {
  switch (event.type) {
    case "question.asked":
      return { kind: "question", key, event };
    case "approval.requested":
      return { kind: "approval", key, event };
    case "cuts.proposed":
      return { kind: "cuts", key, event };
    default:
      return { kind: "error", key, event };
  }
}

function nextTool(current: ToolItem, event: ToolEvent): ToolItem {
  if (event.type === "tool.called") return { ...current, name: event.name, label: event.label };
  if (event.type === "tool.finished") return { ...current, state: event.ok ? "ok" : "failed", summary: event.summary };
  if (event.type === "tool.heartbeat") return { ...current, elapsedS: event.elapsedS };
  return current;
}

function nextJob(current: JobItem, event: JobEvent): JobItem {
  if (event.type === "job.progress") {
    const eta = event.etaS === undefined ? "" : ` · ${formatEta(event.etaS)}`;
    return { ...current, status: "running", progress: `${event.stage} ${Math.round(event.pct)}%${eta}` };
  }
  return { ...current, jobKind: event.kind, status: event.status, progress: event.type === "job.finished" ? null : current.progress };
}

class FeedBuilder {
  readonly items: FeedItem[] = [];
  // Item positions by tool use id / job id, so lifecycle events update one row.
  private readonly positions = new Map<string, number>();

  add(event: StudioEvent, order: number): void {
    const key = `${event.type}-${event.id ?? `p${order}`}`;
    switch (event.type) {
      case "resync":
        return;
      case "question.asked":
      case "approval.requested":
      case "cuts.proposed":
      case "session.error":
        this.items.push(cardItem(event, key));
        return;
      case "text.delta":
      case "narration":
        this.appendAgentText(event.text, key, event.type === "text.delta");
        return;
      case "prompt.submitted":
        this.items.push({ kind: "prompt", key, text: event.text });
        return;
      case "tool.started":
      case "tool.called":
      case "tool.finished":
      case "tool.heartbeat": {
        const fresh: ToolItem = { kind: "tool", key, name: "name" in event ? event.name : "Tool", label: "", state: "running", summary: "", elapsedS: null };
        this.upsert(`tool:${event.toolUseId}`, fresh, (item) => nextTool(item as ToolItem, event));
        return;
      }
      case "job.queued":
      case "job.started":
      case "job.finished":
      case "job.progress": {
        const fresh: JobItem = { kind: "job", key, jobKind: "Job", status: "queued", progress: null };
        this.upsert(`job:${event.jobId}`, fresh, (item) => nextJob(item as JobItem, event));
        return;
      }
      default: {
        const note = describeNote(event);
        if (note) this.items.push({ kind: "note", key, ...note });
      }
    }
  }

  private appendAgentText(text: string, key: string, isDelta: boolean): void {
    const last = this.items.at(-1);
    if (isDelta && last?.kind === "agent") this.items[this.items.length - 1] = { ...last, text: last.text + text };
    else this.items.push({ kind: "agent", key, text });
  }

  private upsert(id: string, fresh: FeedItem, update: (item: FeedItem) => FeedItem): void {
    const position = this.positions.get(id);
    if (position === undefined) {
      this.positions.set(id, this.items.length);
      this.items.push(update(fresh));
    } else this.items[position] = update(this.items[position] as FeedItem);
  }
}

export function buildFeedItems(events: readonly StudioEvent[]): FeedItem[] {
  const builder = new FeedBuilder();
  events.forEach((event, order) => builder.add(event, order));
  return builder.items;
}

export interface SessionSummary {
  readonly sessionId: string | null;
  /** The latest turn's estimate; §6.13 forbids summing these. */
  readonly turnCostUsd: number | null;
  readonly limit: EventOf<"limit"> | null;
  readonly isWorking: boolean;
}

export function summarizeSession(events: readonly StudioEvent[]): SessionSummary {
  let summary: SessionSummary = { sessionId: null, turnCostUsd: null, limit: null, isWorking: false };
  for (const event of events) {
    if (event.type === "session.started") summary = { ...summary, sessionId: event.sessionId };
    else if (event.type === "limit") summary = { ...summary, limit: event };
    else if (event.type === "turn.completed") summary = { ...summary, turnCostUsd: event.costUsd ?? summary.turnCostUsd, isWorking: false };
    else if (event.type === "terminal.state") summary = { ...summary, isWorking: event.state === "working" };
    else if (event.type === "prompt.submitted" || event.type === "tool.started") summary = { ...summary, isWorking: true };
    else if (event.type === "session.error") summary = { ...summary, isWorking: false };
  }
  return summary;
}
