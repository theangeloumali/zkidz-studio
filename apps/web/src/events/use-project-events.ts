// Created by The Angelo Umali.
import { useQueryClient } from "@tanstack/react-query";
import type { StudioEvent } from "@zks/shared";
import { useEffect } from "react";
import { queryKeys } from "../api/queries.ts";
import { connectEvents } from "./connection.ts";
import { useEventsStore } from "./store.ts";

/** Streams one project's events into the store and refetches what they make stale. */
export function useProjectEvents(projectId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { receive, setStatus } = useEventsStore.getState();
    const refetchProject = () => void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });

    function handleEvent(event: StudioEvent): void {
      receive(event);
      if (event.type === "resync") refetchProject();
      else if (event.type === "job.finished") void queryClient.invalidateQueries({ queryKey: queryKeys.media(projectId) });
    }

    return connectEvents({ projectIds: [projectId], onEvent: handleEvent, onResync: refetchProject, onStatus: setStatus });
  }, [projectId, queryClient]);
}
