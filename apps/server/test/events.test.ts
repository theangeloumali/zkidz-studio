// Created by The Angelo Umali.
import { events } from "@zks/db/schema";
import { LAST_EVENT_ID_HEADER, SSE_REPLAY_LIMIT, type StudioEvent } from "@zks/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
