// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";
import { create } from "zustand";
import type { ConnectionStatus } from "./connection.ts";
import { EMPTY_FEED, reduceFeed, type ProjectFeed } from "./feed.ts";

interface EventsState {
  readonly status: ConnectionStatus;
  readonly feeds: Readonly<Record<string, ProjectFeed>>;
  readonly setStatus: (status: ConnectionStatus) => void;
  readonly receive: (event: StudioEvent) => void;
}

export const useEventsStore = create<EventsState>()((set) => ({
  status: "connecting",
  feeds: {},
  setStatus: (status) => set({ status }),
  receive: (event) =>
    set((state) => ({
      feeds: { ...state.feeds, [event.projectId]: reduceFeed(state.feeds[event.projectId] ?? EMPTY_FEED, event) },
    })),
}));
