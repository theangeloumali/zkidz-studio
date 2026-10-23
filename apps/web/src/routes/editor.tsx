// Created by The Angelo Umali.
import { useQuery } from "@tanstack/react-query";
import { FileVideo } from "lucide-react";
import { useParams } from "react-router";
import { ProjectAgent } from "../agent/project-agent.tsx";
import { mediaQuery, projectQuery } from "../api/queries.ts";
import { useProjectEvents } from "../events/use-project-events.ts";
import { useEventsStore } from "../events/store.ts";
import { EditorPanel } from "../editor/editor-panel.tsx";
import { formatBytes, formatMediaMeta } from "../lib/format.ts";

const STATUS_TEXT = { connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…" } as const;

export function EditorRoute() {
  const { projectId = "" } = useParams();
  useProjectEvents(projectId);
  const project = useQuery(projectQuery(projectId));
  const media = useQuery(mediaQuery(projectId));
  const status = useEventsStore((state) => state.status);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-h2 font-extrabold uppercase font-condensed">{project.data?.title ?? "Project"}</h1>
        <p className="font-mono text-ui-sm text-copy-muted" aria-live="polite">
          Events: {STATUS_TEXT[status]}
        </p>
      </div>
      {project.isError && (
        <p role="alert" className="text-ui text-danger">
          {project.error.message}
        </p>
      )}
      <section aria-labelledby="edit-title" className="flex flex-col gap-4">
        <h2 id="edit-title" className="text-ui-lg font-semibold">
          Edit
        </h2>
        <EditorPanel projectId={projectId} />
      </section>
      <section aria-labelledby="media-title" className="flex flex-col gap-4">
        <h2 id="media-title" className="text-ui-lg font-semibold">
          Media
        </h2>
        {media.isPending && <p className="text-ui text-copy-muted">Loading media…</p>}
        {media.isError && (
          <p role="alert" className="text-ui text-danger">
            {media.error.message}
          </p>
        )}
        {media.isSuccess && media.data.length === 0 && <p className="text-ui text-copy-muted">No media in this project yet.</p>}
        {media.isSuccess && media.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {media.data.map((asset) => (
              <li key={asset.id} className="flex items-center gap-4 rounded-card border border-line bg-bg-elevated px-4 py-3">
                <FileVideo aria-hidden="true" className="size-5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui font-semibold">{asset.name}</p>
                  <p className="font-mono text-ui-sm text-copy-muted">{formatMediaMeta(asset)}</p>
                </div>
                <p className="shrink-0 font-mono text-ui-sm text-copy-muted tabular-nums">
                  {formatBytes(asset.bytes)}
                  {asset.isInPlace && " · in place"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="agent-title" className="flex flex-col gap-4">
        <h2 id="agent-title" className="text-ui-lg font-semibold">
          Agent
        </h2>
        <ProjectAgent projectId={projectId} />
      </section>
    </div>
  );
}
