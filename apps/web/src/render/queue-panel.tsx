// Created by The Angelo Umali.
import type { Hardware, Job } from "@zks/shared";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { editorPath } from "../lib/routes.ts";
import { backendChipFor, jobStatusText, jobTitle, stageRowsFor } from "./job-display.ts";
import { PanelSection } from "./panel-section.tsx";
import { StageBar } from "./stage-bar.tsx";

const PROFILE_LABELS: Readonly<Record<Hardware["profile"], string>> = {
  nvidia: "NVIDIA",
  videotoolbox: "VideoToolbox",
  qsv: "Intel Quick Sync",
  amf: "AMD AMF",
  vaapi: "VA-API",
  cpu: "CPU only",
};

interface QueuePanelProps {
  readonly projectId: string;
  readonly jobs: readonly Job[] | undefined;
  readonly hardware: Hardware | undefined;
  readonly loadError: Error | null;
  /** Notices that sit above the job list, such as the CPU fallback. */
  readonly children?: ReactNode;
}

export function QueuePanel({ projectId, jobs, hardware, loadError, children }: QueuePanelProps) {
  return (
    <PanelSection id="render-queue" title="Queue">
      {hardware && (
        <p className="text-ui-sm text-copy-muted">
          Profile: {PROFILE_LABELS[hardware.profile]} · {hardware.encoder} · {hardware.chunks} chunks
        </p>
      )}
      {children}
      {loadError && (
        <p role="alert" className="text-ui text-danger">
          {loadError.message}
        </p>
      )}
      {jobs?.length === 0 && (
        <p className="text-ui text-copy-muted">
          Nothing is rendering. Start a render from the editor.{" "}
          <Link to={editorPath(projectId)} className="font-semibold text-accent underline underline-offset-2">
            Open the Editor
          </Link>
        </p>
      )}
      {jobs && jobs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <JobItem key={job.id} job={job} hardware={hardware} />
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

function JobItem({ job, hardware }: { readonly job: Job; readonly hardware: Hardware | undefined }) {
  const title = jobTitle(job);
  return (
    <li aria-label={title} className="flex flex-col gap-3 rounded-control border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ui font-semibold">{title}</span>
        <span className="rounded-pill border border-line-strong px-2 font-mono text-ui-sm text-copy-muted">{backendChipFor(job, hardware)}</span>
        <span className="ml-auto font-mono text-ui-sm text-copy">{jobStatusText(job)}</span>
      </div>
      <div className="flex flex-col gap-2">
        {stageRowsFor(job).map((stage) => (
          <StageBar key={stage.id} stage={stage} />
        ))}
      </div>
      {job.error && <p className="text-ui-sm text-danger">{job.error}</p>}
    </li>
  );
}
