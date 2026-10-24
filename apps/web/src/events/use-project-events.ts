// Created by The Angelo Umali.
import { useQueryClient } from "@tanstack/react-query";
import type { StudioEvent } from "@zks/shared";
import { useEffect } from "react";
import { queryKeys } from "../api/queries.ts";
import { renderQueryKeys } from "../render/render-api.ts";
import { connectEvents } from "./connection.ts";
import { useEventsStore } from "./store.ts";

/** Streams one project's events into the store and refetches what they make stale. */
export function useProjectEvents(projectId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { receive, setStatus } = useEventsStore.getState();
    const refetch = (queryKey: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey });
    const refetchProject = () => refetch(queryKeys.project(projectId));

    function handleEvent(event: StudioEvent): void {
      receive(event);
      if (event.type === "resync") refetchProject();
      // The job list stops polling once every job is idle, so only these events reveal a new render.
      else if (event.type === "job.queued" || event.type === "job.started") refetch(renderQueryKeys.jobs(projectId));
      else if (event.type === "job.finished") {
        for (const queryKey of [
          renderQueryKeys.jobs(projectId),
          renderQueryKeys.deliverables(projectId),
          renderQueryKeys.qc(projectId),
          queryKeys.media(projectId),
        ])
          refetch(queryKey);
      } else if (event.type === "spec.version") refetch(queryKeys.specs(projectId));
    }

    return connectEvents({ projectIds: [projectId], onEvent: handleEvent, onResync: refetchProject, onStatus: setStatus });
  }, [projectId, queryClient]);
}
