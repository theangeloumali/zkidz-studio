// Created by The Angelo Umali.
// GET /api/events (plan D3): cards still waiting on the user, replay from Last-Event-ID (or ?after=) or one `resync` per project
// past the cap, then live events.
import { EventsQuerySchema, LAST_EVENT_ID_HEADER, LastEventIdSchema, type StudioEvent } from "@zks/shared";
import type { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type { EventBus } from "../events/event-bus.ts";
import { parseOrBadRequest } from "../http/http-error.ts";

const RECONNECT_DELAY_MS = 2000;

export type ListPendingCards = (projectIds: readonly string[]) => StudioEvent[];

export function registerEventRoutes(app: Hono, eventBus: EventBus, listPendingCards: ListPendingCards = () => []): void {
  app.get("/api/events", (c) => {
    const { project: projectIds, after } = parseOrBadRequest(EventsQuerySchema, { project: c.req.queries("project"), after: c.req.query("after") });
    const rawCursor = c.req.header(LAST_EVENT_ID_HEADER);
    // The header comes from the browser's own reconnect, so it is newer than the cursor baked into the URL.
    const cursor = rawCursor === undefined ? (after ?? null) : parseOrBadRequest(LastEventIdSchema, rawCursor);

    return streamSSE(c, async (stream) => {
      const sendFrame = createFrameWriter(stream);
      // Subscribe before replaying, holding live events back, so nothing published during the replay query is lost.
      let bufferedEvents: StudioEvent[] | null = [];
      const unsubscribe = eventBus.subscribe(projectIds, (event) => {
        if (bufferedEvents === null) sendFrame(event, event.id);
        else bufferedEvents.push(event);
      });
      stream.onAbort(unsubscribe);
      // Replay is read before the ready frame, so anything published after the client sees it is strictly newer.
      const replay = cursor === null ? null : await eventBus.replayAfter(projectIds, cursor);
      await stream.write(`retry: ${RECONNECT_DELAY_MS}\n\n`);

      const heldEvents = bufferedEvents;
      bufferedEvents = null;
      // Cards newer than what this stream already covers arrive through the replay or the held events instead.
      const coveredUpTo = replay?.kind === "overflow" ? replay.latestId : cursor;
      const heldIds = new Set(heldEvents.map((event) => event.id));
      const cards = listPendingCards(projectIds).filter((card) => (coveredUpTo === null ? !heldIds.has(card.id) : (card.id ?? 0) <= coveredUpTo));

      let lastSentId = cursor ?? 0;
      if (replay?.kind === "overflow") {
        const at = new Date().toISOString();
        for (const projectId of projectIds) sendFrame({ type: "resync", projectId, at }, replay.latestId);
        // The resync sets the feed's cursor past these cards, so an id would get them dropped as already seen.
        for (const card of cards) sendFrame({ ...card, id: undefined }, undefined);
        lastSentId = replay.latestId;
      } else {
        // Sent without an SSE id so the cursor stays put; a page that already holds a card drops it by its id.
        for (const card of cards) sendFrame(card, undefined);
        for (const event of replay?.events ?? []) sendFrame(event, event.id);
        lastSentId = replay?.events.at(-1)?.id ?? lastSentId;
      }
      for (const event of heldEvents) if (event.id === undefined || event.id > lastSentId) sendFrame(event, event.id);

      if (!stream.aborted) await new Promise<void>((resolve) => stream.onAbort(resolve));
    });
  });
}

/** Writes are chained so frames leave in publish order even though writeSSE is async. */
function createFrameWriter(stream: SSEStreamingApi) {
  let pendingWrite = Promise.resolve();
  return (event: StudioEvent, frameId: number | undefined) => {
    pendingWrite = pendingWrite
      .then(() => stream.writeSSE({ data: JSON.stringify(event), ...(frameId === undefined ? {} : { id: String(frameId) }) }))
      .catch(() => undefined); // a write after the client left has nowhere to go
  };
}
