// Created by The Angelo Umali.
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_ROUTES, type EditSummary, type StudioEvent, type StudioEventType, type UsageFigures } from "@zks/shared";
import { useEffect } from "react";
import { requestJson, routeUrl } from "../api/client.ts";

const { listEdits, latestEdits } = API_ROUTES;

const editsQueryKeys = {
  all: ["edits"] as const,
  project: (projectId: string) => ["edits", "project", projectId] as const,
  latest: ["edits", "latest"] as const,
};

// The events the server's edit recorder writes an edit on; its routes flush before each read.
const EDIT_CHANGING_EVENTS: ReadonlySet<StudioEventType> = new Set(["prompt.submitted", "turn.completed", "usage.reported", "edit.closed"]);

async function fetchProjectEdits(projectId: string): Promise<EditSummary[]> {
  const { edits } = await requestJson(listEdits.response, routeUrl(listEdits.path, { projectId }));
  return edits;
}

async function fetchLatestEdits(): Promise<EditSummary[]> {
  const { edits } = await requestJson(latestEdits.response, latestEdits.path);
  return edits;
}

/** Newest first. */
const projectEditsQuery = (projectId: string) => queryOptions({ queryKey: editsQueryKeys.project(projectId), queryFn: () => fetchProjectEdits(projectId) });
/** Each project's newest edit. */
export const latestEditsQuery = () => queryOptions({ queryKey: editsQueryKeys.latest, queryFn: fetchLatestEdits });

/** A project's edits, refetched each time the stream changes one; findLast still sees a change a later event buried. */
export function useProjectEdits(projectId: string, events: readonly StudioEvent[]) {
  const queryClient = useQueryClient();
  const lastChange = events.findLast((event) => EDIT_CHANGING_EVENTS.has(event.type));
  // Tracked apart: a usage event in the same batch must not hide the close that the latest list waits for.
  const lastClose = events.findLast((event) => event.type === "edit.closed");
  // Usage refreshes on every assistant message, so it refetches only this project.
  useEffect(() => {
    if (lastChange !== undefined) void queryClient.invalidateQueries({ queryKey: editsQueryKeys.project(projectId) });
  }, [lastChange, projectId, queryClient]);
  useEffect(() => {
    if (lastClose !== undefined) void queryClient.invalidateQueries({ queryKey: editsQueryKeys.latest });
  }, [lastClose, queryClient]);
  return useQuery(projectEditsQuery(projectId));
}

/** The figures formatUsage reads; an open edit is timed up to `now`. */
export function editFigures(edit: EditSummary, now: Date = new Date()): UsageFigures {
  const endMs = edit.finishedAt === null ? now.getTime() : Date.parse(edit.finishedAt);
  return {
    durationMs: endMs - Date.parse(edit.startedAt),
    ...(edit.costUsd === null ? {} : { costUsd: edit.costUsd }),
    ...(edit.inputTokens === null ? {} : { inputTokens: edit.inputTokens }),
    ...(edit.outputTokens === null ? {} : { outputTokens: edit.outputTokens }),
    ...(edit.cacheTokens === null ? {} : { cacheTokens: edit.cacheTokens }),
  };
}
