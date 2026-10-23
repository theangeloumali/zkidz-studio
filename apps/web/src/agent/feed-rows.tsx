// Created by The Angelo Umali.
import { CircleAlert, CircleCheck, CircleX, Info, LoaderCircle } from "lucide-react";
import type { FeedItem, JobItem, ToolItem } from "./feed-items.ts";

const TOOL_ICON = { running: LoaderCircle, ok: CircleCheck, failed: CircleX } as const;
const TOOL_STATE_TEXT = { running: "Running", ok: "Done", failed: "Failed" } as const;

export function ToolRow({ item }: { readonly item: ToolItem }) {
  const Icon = TOOL_ICON[item.state];
  return (
    <div className="flex items-start gap-3 text-ui">
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${item.state === "failed" ? "text-danger" : "text-copy-muted"}`} />
      <div className="min-w-0 flex-1">
        <p className="break-words text-copy">{item.label || item.name}</p>
        <p className="font-mono text-ui-sm break-words text-copy-muted">
          {TOOL_STATE_TEXT[item.state]}
          {item.elapsedS !== null && item.state === "running" ? ` · ${Math.round(item.elapsedS)} s` : ""}
          {item.summary ? ` · ${item.summary}` : ""}
        </p>
      </div>
    </div>
  );
}

export function JobRow({ item }: { readonly item: JobItem }) {
  return (
    <p className="font-mono text-ui-sm break-words text-copy-muted">
      {item.jobKind} · {item.progress ?? item.status}
    </p>
  );
}

export function NoteRow({ item }: { readonly item: Extract<FeedItem, { kind: "note" }> }) {
  const Icon = item.tone === "warn" ? CircleAlert : Info;
  return (
    <p className={`flex items-start gap-2 text-ui-sm break-words ${item.tone === "warn" ? "text-copy" : "text-copy-muted"}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {item.text}
    </p>
  );
}
