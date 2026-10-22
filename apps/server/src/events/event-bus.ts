// Created by The Angelo Umali.
// One in-process bus (plan D3): durable events are stored first so their row id can serve as the SSE replay cursor.
import type { StudioDatabase } from "@zks/db";
import { events } from "@zks/db/schema";
import { EPHEMERAL_EVENT_TYPES, SSE_REPLAY_LIMIT, StudioEventSchema, type StudioEvent } from "@zks/shared";
import { and, asc, gt, inArray, max } from "drizzle-orm";

/** What a publisher supplies; the bus stamps `at`, and `id` for durable events. */
export type NewStudioEvent = StudioEvent extends infer Event ? (Event extends StudioEvent ? Omit<Event, "id" | "at"> : never) : never;
export type EventListener = (event: StudioEvent) => void;
export type ReplayResult = { readonly kind: "events"; readonly events: StudioEvent[] } | { readonly kind: "overflow"; readonly latestId: number };

interface Subscription {
  readonly projectIds: ReadonlySet<string>;
  readonly listener: EventListener;
}

const EPHEMERAL_TYPES: ReadonlySet<string> = new Set(EPHEMERAL_EVENT_TYPES);

export class EventBus {
  readonly #database: StudioDatabase;
  readonly #subscriptions = new Set<Subscription>();

  constructor(database: StudioDatabase) {
    this.#database = database;
  }

  async publish(newEvent: NewStudioEvent): Promise<StudioEvent> {
    const stampedEvent = StudioEventSchema.parse({ ...newEvent, at: new Date().toISOString() });
    if (EPHEMERAL_TYPES.has(stampedEvent.type)) {
      this.#deliver(stampedEvent);
      return stampedEvent;
    }
    const { type, projectId, at, id: _unsetId, ...payload } = stampedEvent;
    const jobId = "jobId" in payload ? payload.jobId : null;
    const [row] = await this.#database
      .insert(events)
      .values({ projectId, jobId, type, payload, createdAt: new Date(at) })
      .returning({ id: events.id });
    if (row === undefined) throw new Error("events insert returned no row");
    const storedEvent = StudioEventSchema.parse({ ...stampedEvent, id: row.id });
    this.#deliver(storedEvent);
    return storedEvent;
  }

  subscribe(projectIds: readonly string[], listener: EventListener): () => void {
    const subscription = { projectIds: new Set(projectIds), listener };
    this.#subscriptions.add(subscription);
    return () => this.#subscriptions.delete(subscription);
  }

  /** Past SSE_REPLAY_LIMIT the client must refetch state instead, so the newest id is all it gets. */
  async replayAfter(projectIds: readonly string[], afterId: number): Promise<ReplayResult> {
    const rows = await this.#database
      .select()
      .from(events)
      .where(and(inArray(events.projectId, [...projectIds]), gt(events.id, afterId)))
      .orderBy(asc(events.id))
      .limit(SSE_REPLAY_LIMIT + 1);
    if (rows.length <= SSE_REPLAY_LIMIT) return { kind: "events", events: rows.map(rowToEvent) };
    const [newest] = await this.#database
      .select({ latestId: max(events.id) })
      .from(events)
      .where(inArray(events.projectId, [...projectIds]));
    return { kind: "overflow", latestId: newest?.latestId ?? afterId };
  }

  #deliver(event: StudioEvent): void {
    for (const subscription of this.#subscriptions) {
      if (subscription.projectIds.has(event.projectId)) subscription.listener(event);
    }
  }
}

function rowToEvent(row: typeof events.$inferSelect): StudioEvent {
  const payload = typeof row.payload === "object" && row.payload !== null ? row.payload : {};
  return StudioEventSchema.parse({ ...payload, type: row.type, id: row.id, projectId: row.projectId, at: row.createdAt.toISOString() });
}
