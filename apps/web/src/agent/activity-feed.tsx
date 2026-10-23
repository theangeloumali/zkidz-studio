// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";
import { useMemo } from "react";
import { ApprovalCard } from "./approval-card.tsx";
import { CutsCard } from "./cuts-card.tsx";
import { ErrorCard } from "./error-card.tsx";
import { buildFeedItems, type FeedItem } from "./feed-items.ts";
import { JobRow, NoteRow, ToolRow } from "./feed-rows.tsx";
import { QuestionCard } from "./question-card.tsx";

function FeedEntry({ item, projectId }: { readonly item: FeedItem; readonly projectId: string }) {
  switch (item.kind) {
    case "prompt":
      return <p className="ml-auto max-w-[85%] rounded-card bg-surface px-4 py-2 text-ui break-words whitespace-pre-wrap text-copy">{item.text}</p>;
    case "agent":
      return <p className="max-w-[65ch] text-ui break-words whitespace-pre-wrap text-copy">{item.text}</p>;
    case "tool":
      return <ToolRow item={item} />;
    case "job":
      return <JobRow item={item} />;
    case "note":
      return <NoteRow item={item} />;
    case "approval":
      return <ApprovalCard projectId={projectId} event={item.event} />;
    case "question":
      return <QuestionCard projectId={projectId} event={item.event} />;
    case "cuts":
      return <CutsCard projectId={projectId} event={item.event} />;
    case "error":
      return <ErrorCard event={item.event} />;
  }
}

/** Every string is a React text child, never markup, so agent and tool text cannot inject HTML. */
export function ActivityFeed({ projectId, events }: { readonly projectId: string; readonly events: readonly StudioEvent[] }) {
  const items = useMemo(() => buildFeedItems(events), [events]);
  return (
    <>
      {items.length === 0 ? (
        <div className="flex flex-col gap-1 py-6 text-center">
          <p className="text-ui-lg font-semibold text-copy">Tell the agent what you want</p>
          <p className="mx-auto max-w-[50ch] text-ui text-copy-muted">
            It transcribes, plans cuts, writes captions and adds overlays. You approve before anything renders.
          </p>
        </div>
      ) : null}
      <ol aria-label="Agent activity" aria-live="polite" className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.key} className="flex flex-col">
            <FeedEntry item={item} projectId={projectId} />
          </li>
        ))}
      </ol>
    </>
  );
}
