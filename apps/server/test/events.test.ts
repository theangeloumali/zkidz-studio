// Created by The Angelo Umali.
import { events } from "@zks/db/schema";
import { LAST_EVENT_ID_HEADER, SSE_REPLAY_LIMIT, type StudioEvent } from "@zks/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DecisionBroker } from "../src/agent/decisions.ts";
import { openSseReader } from "./support/sse-reader.ts";
import { createTestServer, getRequest, insertProject, type TestServer } from "./support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

const narration = (projectId: string, text: string) => ({ type: "narration" as const, projectId, text });

describe("EventBus", () => {
  it("persists durable events with an id and delivers them to that project's subscribers only", async () => {
    const [watched, other] = [await insertProject(server), await insertProject(server)];
    const received: StudioEvent[] = [];
    const unsubscribe = server.eventBus.subscribe([watched.id], (event) => received.push(event));
    const published = await server.eventBus.publish(narration(watched.id, "hello"));
    await server.eventBus.publish(narration(other.id, "elsewhere"));
    unsubscribe();
    await server.eventBus.publish(narration(watched.id, "after unsubscribe"));

    expect(published.id).toBeGreaterThan(0);
    expect(received).toEqual([published]);
    const [row] = await server.database.db
      .select()
      .from(events)
      .where(eq(events.id, published.id ?? 0));
    expect(row).toMatchObject({ type: "narration", payload: { text: "hello" } });
  });

  it("delivers ephemeral events without persisting them", async () => {
    const project = await insertProject(server);
    const received: StudioEvent[] = [];
    server.eventBus.subscribe([project.id], (event) => received.push(event));
    await server.eventBus.publish({ type: "text.delta", projectId: project.id, text: "tok" });
    expect(received).toMatchObject([{ type: "text.delta", text: "tok" }]);
    expect(received[0]?.id).toBeUndefined();
    expect(await server.database.db.select().from(events).where(eq(events.projectId, project.id))).toEqual([]);
  });

  it("rejects an event that does not match the shared contract", async () => {
    const project = await insertProject(server);
    await expect(server.eventBus.publish({ type: "job.progress", projectId: project.id, jobId: "nope", stage: "x", pct: 500 })).rejects.toThrow();
  });
});

describe("GET /api/events", () => {
  it("rejects a missing or malformed project list", async () => {
    expect((await getRequest(server, "/api/events")).status).toBe(400);
    expect((await getRequest(server, "/api/events?project=not-a-uuid")).status).toBe(400);
  });

  it("rejects a malformed Last-Event-ID", async () => {
    const project = await insertProject(server);
    const response = await getRequest(server, `/api/events?project=${project.id}`, { [LAST_EVENT_ID_HEADER]: "abc" });
    expect(response.status).toBe(400);
  });

  it("streams live events as id + JSON data frames", async () => {
    const project = await insertProject(server);
    const response = await getRequest(server, `/api/events?project=${project.id}`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const sse = await openSseReader(response);
    const published = await server.eventBus.publish(narration(project.id, "live"));
    const [frame] = await sse.nextFrames(1);
    await sse.close();
    expect(frame).toEqual({ id: String(published.id), data: published });
  });

  it("replays what a reconnecting client missed, in order, then goes live", async () => {
    const [project, other] = [await insertProject(server), await insertProject(server)];
    const seen = await server.eventBus.publish(narration(project.id, "seen"));
    const missedFirst = await server.eventBus.publish(narration(project.id, "missed 1"));
    await server.eventBus.publish(narration(other.id, "not mine"));
    const missedSecond = await server.eventBus.publish(narration(project.id, "missed 2"));

    const response = await getRequest(server, `/api/events?project=${project.id}`, { [LAST_EVENT_ID_HEADER]: String(seen.id) });
    const sse = await openSseReader(response);
    const live = await server.eventBus.publish(narration(project.id, "live"));
    const frames = await sse.nextFrames(3);
    await sse.close();
    expect(frames.map((frame) => frame.data)).toEqual([missedFirst, missedSecond, live]);
  });

  it("replays from ?after= when a reloaded page opens a new stream without Last-Event-ID", async () => {
    const project = await insertProject(server);
    const seen = await server.eventBus.publish(narration(project.id, "seen before reload"));
    const missed = await server.eventBus.publish(narration(project.id, "missed during reload"));

    const sse = await openSseReader(await getRequest(server, `/api/events?project=${project.id}&after=${seen.id}`));
    const live = await server.eventBus.publish(narration(project.id, "live"));
    const frames = await sse.nextFrames(2);
    await sse.close();
    expect(frames.map((frame) => frame.data)).toEqual([missed, live]);
  });

  it("prefers Last-Event-ID over ?after=, because the browser's own reconnect sends the newer cursor", async () => {
    const project = await insertProject(server);
    const stale = await server.eventBus.publish(narration(project.id, "stale cursor"));
    const seen = await server.eventBus.publish(narration(project.id, "seen"));
    const missed = await server.eventBus.publish(narration(project.id, "missed"));

    const response = await getRequest(server, `/api/events?project=${project.id}&after=${stale.id}`, { [LAST_EVENT_ID_HEADER]: String(seen.id) });
    const sse = await openSseReader(response);
    const [frame] = await sse.nextFrames(1);
    await sse.close();
    expect(frame?.data).toEqual(missed);
  });

  it("rejects a malformed ?after= cursor", async () => {
    const project = await insertProject(server);
    expect((await getRequest(server, `/api/events?project=${project.id}&after=abc`)).status).toBe(400);
  });

  it(`sends resync instead of replaying more than ${SSE_REPLAY_LIMIT} events`, async () => {
    const project = await insertProject(server);
    const cursor = await server.eventBus.publish(narration(project.id, "cursor"));
    let newest = cursor;
    for (let index = 0; index <= SSE_REPLAY_LIMIT; index += 1) newest = await server.eventBus.publish(narration(project.id, `n${index}`));

    const response = await getRequest(server, `/api/events?project=${project.id}`, { [LAST_EVENT_ID_HEADER]: String(cursor.id) });
    const sse = await openSseReader(response);
    const live = await server.eventBus.publish(narration(project.id, "after resync"));
    const frames = await sse.nextFrames(2);
    await sse.close();
    expect(frames[0]).toMatchObject({ id: String(newest.id), data: { type: "resync", projectId: project.id } });
    expect(frames[1]?.data).toEqual(live);
  }, 60_000);
});

describe("GET /api/events with cards still waiting on the user", () => {
  let cardServer: TestServer;
  let broker: DecisionBroker;
  beforeAll(async () => {
    cardServer = await createTestServer((base) => {
      broker = new DecisionBroker({ publish: (event) => base.eventBus.publish(event) });
      return { agent: { registerRoutes: () => undefined, pendingCards: (projectIds) => broker.pendingCards(projectIds) } };
    });
  });
  afterAll(async () => {
    await cardServer.close();
  });

  async function askAndPublishAfter(projectId: string) {
    void broker.askQuestions(projectId, [{ question: "Which take?", header: "Take", options: [{ label: "A" }, { label: "B" }], multiSelect: false }]);
    // The card is held only once the bus has persisted it and handed back its id.
    await vi.waitFor(() => expect(broker.pendingCards([projectId])).toHaveLength(1));
    const [card] = broker.pendingCards([projectId]);
    if (card === undefined) throw new Error("the question card was not published");
    return { card, later: await cardServer.eventBus.publish(narration(projectId, "after the card")) };
  }

  it("sends a new tab every pending card first, without moving its cursor", async () => {
    const project = await insertProject(cardServer);
    const { card } = await askAndPublishAfter(project.id);

    const sse = await openSseReader(await getRequest(cardServer, `/api/events?project=${project.id}`));
    const live = await cardServer.eventBus.publish(narration(project.id, "live"));
    const frames = await sse.nextFrames(2);
    await sse.close();
    expect(frames).toEqual([
      { id: undefined, data: card },
      { id: String(live.id), data: live },
    ]);
  });

  it("sends a reloaded page the cards older than its cursor, then the replay", async () => {
    const project = await insertProject(cardServer);
    const { card, later } = await askAndPublishAfter(project.id);
    const missed = await cardServer.eventBus.publish(narration(project.id, "missed during reload"));

    const sse = await openSseReader(await getRequest(cardServer, `/api/events?project=${project.id}&after=${later.id}`));
    const frames = await sse.nextFrames(2);
    await sse.close();
    expect(frames).toEqual([
      { id: undefined, data: card },
      { id: String(missed.id), data: missed },
    ]);
  });

  it("leaves a card newer than the cursor to the replay, so it arrives once", async () => {
    const project = await insertProject(cardServer);
    const seen = await cardServer.eventBus.publish(narration(project.id, "seen"));
    const { card, later } = await askAndPublishAfter(project.id);

    const sse = await openSseReader(await getRequest(cardServer, `/api/events?project=${project.id}&after=${seen.id}`));
    const frames = await sse.nextFrames(2);
    await sse.close();
    expect(frames.map((frame) => frame.data)).toEqual([card, later]);
  });

  it("sends the cards after a resync without their ids, since the cleared feed would drop them as already seen", async () => {
    const project = await insertProject(cardServer);
    const { card, later } = await askAndPublishAfter(project.id);
    for (let index = 0; index <= SSE_REPLAY_LIMIT; index += 1) await cardServer.eventBus.publish(narration(project.id, `n${index}`));

    const sse = await openSseReader(await getRequest(cardServer, `/api/events?project=${project.id}`, { [LAST_EVENT_ID_HEADER]: String(later.id) }));
    const frames = await sse.nextFrames(2);
    await sse.close();
    expect(frames[0]?.data).toMatchObject({ type: "resync" });
    const { id: _cardId, ...cardWithoutId } = card;
    expect(frames[1]).toEqual({ id: undefined, data: cardWithoutId });
  }, 60_000);
});
