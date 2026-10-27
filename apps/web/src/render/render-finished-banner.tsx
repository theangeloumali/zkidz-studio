// Created by The Angelo Umali.
import { OpenFolderButton } from "./open-folder-button.tsx";

interface RenderFinishedBannerProps {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly fileCount: number;
}

/** The screen's one gold flood band; data-tone="flood" re-themes its text and button for the gold ground. */
export function RenderFinishedBanner({ projectId, projectSlug, fileCount }: RenderFinishedBannerProps) {
  const folder = `ZKS_HOME/projects/${projectSlug}/deliverables/`;
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
      </div>
      <OpenFolderButton projectId={projectId} variant="primary" />
    </div>
  );
}
