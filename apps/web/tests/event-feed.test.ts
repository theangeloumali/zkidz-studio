// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { EMPTY_FEED, reduceFeed } from "../src/events/feed.ts";
import { PROJECT_ID } from "./fakes.ts";

const AT = "2026-10-21T10:00:00.000Z";

function narration(id: number | undefined, text: string): StudioEvent {
  return { type: "narration", projectId: PROJECT_ID, at: AT, text, ...(id === undefined ? {} : { id }) };
}

describe("reduceFeed", () => {
  it("appends events and advances the cursor", () => {
    const feed = [narration(1, "a"), narration(2, "b")].reduce(reduceFeed, EMPTY_FEED);

    expect(feed.events.map((event) => event.id)).toEqual([1, 2]);
    expect(feed.lastEventId).toBe(2);
  });

  it("drops a replayed event the feed already holds", () => {
    const feed = [narration(1, "a"), narration(2, "b"), narration(2, "b"), narration(1, "a")].reduce(reduceFeed, EMPTY_FEED);

    expect(feed.events).toHaveLength(2);
  });

  it("keeps bus-only events that carry no id without moving the cursor", () => {
    const feed = [narration(4, "a"), narration(undefined, "live")].reduce(reduceFeed, EMPTY_FEED);

    expect(feed.events).toHaveLength(2);
    expect(feed.lastEventId).toBe(4);
  });

  it("clears the feed on resync", () => {
    const resync: StudioEvent = { type: "resync", projectId: PROJECT_ID, at: AT, id: 900 };
    const feed = [narration(1, "a"), resync].reduce(reduceFeed, EMPTY_FEED);

    expect(feed.events).toEqual([]);
    expect(feed.lastEventId).toBe(900);
  });
});
