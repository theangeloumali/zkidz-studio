// Created by The Angelo Umali.
import { SSE_REPLAY_LIMIT, type StudioEvent } from "@zks/shared";

export interface ProjectFeed {
  readonly events: readonly StudioEvent[];
  /** The highest persisted id seen; replays at or below it are duplicates. */
  readonly lastEventId: number | null;
}

export const EMPTY_FEED: ProjectFeed = { events: [], lastEventId: null };

export function reduceFeed(feed: ProjectFeed, event: StudioEvent): ProjectFeed {
  if (event.type === "resync") return { events: [], lastEventId: event.id ?? feed.lastEventId };
  if (event.id !== undefined && feed.lastEventId !== null && event.id <= feed.lastEventId) return feed;
  return {
    events: [...feed.events, event].slice(-SSE_REPLAY_LIMIT),
    lastEventId: event.id ?? feed.lastEventId,
  };
}
