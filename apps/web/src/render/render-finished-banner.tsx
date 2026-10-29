// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";
import { editFigures, useProjectEdits } from "../edits/edits-client.ts";
import { useEventsStore } from "../events/store.ts";
import { formatUsage } from "../lib/format.ts";
import { OpenFolderButton } from "./open-folder-button.tsx";

// A stable empty list, so the store selector does not hand React a new array every render.
const NO_EVENTS: readonly StudioEvent[] = [];

interface RenderFinishedBannerProps {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly fileCount: number;
}

/** The screen's one gold flood band; data-tone="flood" re-themes its text and button for the gold ground. */
export function RenderFinishedBanner({ projectId, projectSlug, fileCount }: RenderFinishedBannerProps) {
  const folder = `ZKS_HOME/projects/${projectSlug}/deliverables/`;
  const events = useEventsStore((state) => state.feeds[projectId]?.events ?? NO_EVENTS);
  const edits = useProjectEdits(projectId, events);
  // Newest first, so this is the edit the export just closed.
  const finishedEdit = edits.data?.find((edit) => edit.status === "closed");
  return (
    <div
      role="status"
      aria-labelledby="render-finished-title"
      data-tone="flood"
      className="flex flex-col gap-4 rounded-card px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p id="render-finished-title" className="font-display text-h3 font-extrabold uppercase font-condensed">
          Render finished
        </p>
        <p className="text-ui text-copy-muted">
          {fileCount} {fileCount === 1 ? "file" : "files"} in <span className="break-all font-mono text-copy">{folder}</span>, each checked by SHA-256 against
          the render.
        </p>
        {finishedEdit === undefined ? null : <p className="text-ui text-copy-muted">This edit took {formatUsage(editFigures(finishedEdit))}.</p>}
      </div>
      <OpenFolderButton projectId={projectId} variant="primary" />
    </div>
  );
}
