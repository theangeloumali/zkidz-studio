// Created by The Angelo Umali.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { renderQueryKeys } from "./render-api.ts";

/** Deliverables and checks poll only while a job runs, so the last export's files would otherwise never be fetched. */
export function useRefreshOnRenderEnd(projectId: string, isRendering: boolean): void {
  const queryClient = useQueryClient();
  const wasRendering = useRef(isRendering);

  useEffect(() => {
    if (wasRendering.current && !isRendering) {
      void queryClient.invalidateQueries({ queryKey: renderQueryKeys.deliverables(projectId) });
      void queryClient.invalidateQueries({ queryKey: renderQueryKeys.qc(projectId) });
    }
    wasRendering.current = isRendering;
  }, [projectId, isRendering, queryClient]);
}
