// Created by The Angelo Umali.
import { formatBytes } from "../lib/format.ts";
import { OpenFolderButton } from "./open-folder-button.tsx";
import { PanelSection } from "./panel-section.tsx";
import type { Deliverable } from "./render-api.ts";

const HASH_HEAD_CHARS = 8;
const HASH_TAIL_CHARS = 6;

function shortHash(sha256: string): string {
  return `sha256 ${sha256.slice(0, HASH_HEAD_CHARS)}…${sha256.slice(-HASH_TAIL_CHARS)}`;
}

interface DeliverablesPanelProps {
  readonly projectId: string;
  readonly deliverables: readonly Deliverable[] | undefined;
  /** False while the finished banner carries the one Open folder button. */
  readonly canOpenFolder: boolean;
}

export function DeliverablesPanel({ projectId, deliverables, canOpenFolder }: DeliverablesPanelProps) {
  const hasFiles = deliverables !== undefined && deliverables.length > 0;
  const openFolderButton = hasFiles && canOpenFolder && <OpenFolderButton projectId={projectId} variant="secondary" />;

  return (
    <PanelSection id="render-deliverables" title="Deliverables" action={openFolderButton}>
      {deliverables?.length === 0 && <p className="text-ui text-copy-muted">No files yet.</p>}
      {hasFiles && (
        <ul className="flex flex-col divide-y divide-line">
          {deliverables.map((file) => (
            <li key={file.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 break-all text-ui font-semibold">{file.name}</span>
              <span className="text-ui-sm text-copy-muted">{formatBytes(file.bytes)}</span>
              <span title={file.sha256} className="ml-auto font-mono text-ui-sm text-copy-dim">
                {shortHash(file.sha256)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}
