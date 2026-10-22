// Created by The Angelo Umali.
import { CircleAlert, CircleCheck } from "lucide-react";
import { formatBytes } from "../lib/format.ts";

export type UploadState =
  { readonly kind: "uploading"; readonly fraction: number } | { readonly kind: "done" } | { readonly kind: "failed"; readonly reason: string };

export interface UploadItem {
  readonly key: string;
  readonly name: string;
  readonly bytes: number;
  readonly state: UploadState;
}

const PERCENT = 100;

export function UploadList({ items }: { readonly items: readonly UploadItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Uploads" className="flex flex-col divide-y divide-line rounded-card border border-line bg-bg-elevated">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-baseline justify-between gap-4 text-ui">
            <span className="min-w-0 truncate font-medium">{item.name}</span>
            <span className="shrink-0 font-mono text-ui-sm text-copy-muted tabular-nums">{formatBytes(item.bytes)}</span>
          </div>
          <UploadStatus item={item} />
        </li>
      ))}
    </ul>
  );
}

function UploadStatus({ item }: { readonly item: UploadItem }) {
  const { state } = item;
  if (state.kind === "failed") {
    return (
      <p className="flex items-center gap-2 text-ui-sm text-danger">
        <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
        {state.reason}
      </p>
    );
  }
  const percent = state.kind === "done" ? PERCENT : Math.round(state.fraction * PERCENT);
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={`Uploading ${item.name}`}
        aria-valuemin={0}
        aria-valuemax={PERCENT}
        aria-valuenow={percent}
        className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface"
      >
        {/* scaleX keeps the bar on the compositor; width would relayout every progress tick. */}
        <div
          className="h-full origin-left bg-accent transition-transform duration-(--dur-2) ease-linear"
          style={{ transform: `scaleX(${percent / PERCENT})` }}
        />
      </div>
      {state.kind === "done" ? (
        <CircleCheck aria-label="Uploaded" className="size-4 shrink-0 text-success" />
      ) : (
        <span className="w-10 shrink-0 text-right font-mono text-ui-sm text-copy-muted tabular-nums">{percent}%</span>
      )}
    </div>
  );
}
