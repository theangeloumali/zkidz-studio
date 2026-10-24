// Created by The Angelo Umali.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { submitPrompt } from "../../api/agent-client.ts";
import { projectQuery } from "../../api/queries.ts";
import { useProjectEvents } from "../../events/use-project-events.ts";
import { editorPath } from "../../lib/routes.ts";
import { ChecksPanel } from "../../render/checks-panel.tsx";
import { CpuNotice } from "../../render/cpu-notice.tsx";
import { DeliverablesPanel } from "../../render/deliverables-panel.tsx";
import { HardwarePanel } from "../../render/hardware-panel.tsx";
import { isJobActive } from "../../render/job-display.ts";
import { QueuePanel } from "../../render/queue-panel.tsx";
import { deliverablesQuery, hardwareQuery, jobsQuery, qcChecksQuery } from "../../render/render-api.ts";
import { RenderFinishedBanner } from "../../render/render-finished-banner.tsx";
import { RENDER_TARGET_OPTIONS, isRenderFinished, renderRequestText, type MasterQuality, type RenderTargetId } from "../../render/render-request.ts";
import { TargetPicker } from "../../render/target-picker.tsx";
import { useRefreshOnRenderEnd } from "../../render/use-refresh-on-render-end.ts";

const ALL_TARGET_IDS: readonly RenderTargetId[] = RENDER_TARGET_OPTIONS.map((option) => option.id);

export function RenderRoute() {
  const { projectId = "" } = useParams();
  useProjectEvents(projectId);
  const project = useQuery(projectQuery(projectId));
  const jobs = useQuery(jobsQuery(projectId));
  const isRendering = jobs.data?.some(isJobActive) ?? false;
  const hardware = useQuery(hardwareQuery(isRendering));
  const checks = useQuery(qcChecksQuery(projectId, isRendering));
  const deliverables = useQuery(deliverablesQuery(projectId, isRendering));
  useRefreshOnRenderEnd(projectId, isRendering);
  const [selectedTargetIds, setSelectedTargetIds] = useState<readonly RenderTargetId[]>(ALL_TARGET_IDS);
  const renderRequest = useMutation({ mutationFn: (quality: MasterQuality) => submitPrompt(projectId, renderRequestText(selectedTargetIds, quality)) });

  const fileCount = deliverables.data?.length ?? 0;
  const isFinished = fileCount > 0 && isRenderFinished(jobs.data ?? []);
  const toggleTarget = (targetId: RenderTargetId, isSelected: boolean) =>
    setSelectedTargetIds((current) => ALL_TARGET_IDS.filter((id) => (id === targetId ? isSelected : current.includes(id))));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-h2 font-extrabold uppercase font-condensed">Render &amp; export</h1>
        <TargetPicker selectedIds={selectedTargetIds} isSending={renderRequest.isPending} onToggle={toggleTarget} onRender={() => renderRequest.mutate("4k")} />
        <RenderRequestStatus projectId={projectId} isSent={renderRequest.isSuccess} error={renderRequest.error} />
      </div>
      {isFinished && project.data && <RenderFinishedBanner projectId={projectId} projectSlug={project.data.slug} fileCount={fileCount} />}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <QueuePanel projectId={projectId} jobs={jobs.data} hardware={hardware.data ?? undefined} loadError={jobs.error}>
            {hardware.data?.profile === "cpu" && <CpuNotice isSending={renderRequest.isPending} onRender1080={() => renderRequest.mutate("final")} />}
          </QueuePanel>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <HardwarePanel hardware={hardware.data} isUnavailable={hardware.isError} />
          <ChecksPanel checks={checks.data} />
          <DeliverablesPanel projectId={projectId} deliverables={deliverables.data} canOpenFolder={!isFinished} />
        </div>
      </div>
    </div>
  );
}

interface RenderRequestStatusProps {
  readonly projectId: string;
  readonly isSent: boolean;
  readonly error: Error | null;
}

/** render_master is approval-gated, and approvals show in the Editor's agent pane. */
function RenderRequestStatus({ projectId, isSent, error }: RenderRequestStatusProps) {
  return (
    <p role="status" className="min-h-[1lh] text-ui text-copy-muted">
      {error && <span className="text-danger">{error.message}</span>}
      {isSent && (
        <>
          Sent to the agent. Approve the render in the Editor.{" "}
          <Link to={editorPath(projectId)} className="font-semibold text-accent underline underline-offset-2">
            Open the Editor
          </Link>
        </>
      )}
    </p>
  );
}
