// Created by The Angelo Umali.
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@zks/shared";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { projectsQuery } from "../api/queries.ts";
import { formatDate } from "../lib/format.ts";
import { editorPath } from "../lib/routes.ts";
import { buttonClass } from "./button-class.ts";

const STATUS_LABELS: Record<Project["status"], string> = {
  draft: "Draft",
  editing: "Editing",
  rendering: "Rendering",
  delivered: "Delivered",
  archived: "Archived",
};

export function RecentProjects() {
  const projects = useQuery(projectsQuery());

  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-4">
      <h2 id="recent-title" className="font-display text-h3 font-extrabold uppercase font-condensed">
        Recent projects
      </h2>
      {projects.isPending && (
        <div role="status" aria-label="Loading projects" className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-16 animate-pulse rounded-card bg-surface motion-reduce:animate-none" />
          ))}
        </div>
      )}
      {projects.isError && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-card border border-line bg-bg-elevated p-5">
          <p className="text-ui text-danger">{projects.error.message}</p>
          <button type="button" className={buttonClass("secondary")} onClick={() => void projects.refetch()}>
            Try again
          </button>
        </div>
      )}
      {projects.isSuccess && projects.data.length === 0 && (
        <div className="rounded-card border border-line bg-bg-elevated p-6">
          <p className="text-ui-lg font-semibold">No projects yet</p>
          <p className="pt-1 text-ui text-copy-muted">Drop a video above to start your first edit.</p>
        </div>
      )}
      {projects.isSuccess && projects.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {projects.data.map((project) => (
            <li key={project.id}>
              <Link
                to={editorPath(project.id)}
                className="group flex min-h-(--target-min) items-center gap-4 rounded-card border border-line bg-bg-elevated px-4 py-3 transition-colors duration-(--dur-hover) hover:border-line-strong"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui-lg font-semibold">{project.title}</span>
                  <span className="block font-mono text-ui-sm text-copy-muted">
                    {project.videoId} · {formatDate(project.updatedAt)}
                  </span>
                </span>
                <span className="shrink-0 rounded-pill border border-line-strong px-3 py-1 text-ui-sm text-copy-muted">{STATUS_LABELS[project.status]}</span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-copy-dim" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
