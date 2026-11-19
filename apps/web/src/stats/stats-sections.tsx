// Created by The Angelo Umali.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatTokenCount, type Stats, type StatsJob } from "@zks/shared";
import { CircleAlert, CircleCheck } from "lucide-react";
import { formatDateTime, formatDuration } from "../lib/format.ts";
import { PROJECT_STATUS_LABELS } from "../lib/project-status.ts";
import { jobKindLabel, jobTotals, percent } from "./stats-figures.ts";

const SECTION_TITLE = "font-display text-ui font-extrabold uppercase tracking-[0.02em] font-condensed";
const TABLE_HEAD = "border-b border-line-strong px-2 pb-2 text-right text-ui-sm font-semibold text-copy-dim";
const TABLE_CELL = "border-b border-line px-2 py-2.5 text-right tabular-nums";
const NONE = "–";

function Section({ id, title, children }: { readonly id: string; readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className={SECTION_TITLE}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function StatsLedger({ stats }: { readonly stats: Stats }) {
  const totals = jobTotals(stats);
  const deliverables = stats.deliverablesByWeek.reduce((total, row) => total + row.count, 0);
  const cells = [
    { label: "Jobs", value: String(totals.jobs), note: `${totals.finished - totals.failed} finished · ${totals.failed} failed · ${deliverables} delivered` },
    {
      label: "Median job time",
      value: stats.medianRunS === null ? NONE : formatDuration(stats.medianRunS),
      note: `Waits ${stats.medianQueueWaitS === null ? NONE : formatDuration(stats.medianQueueWaitS)} in the queue`,
    },
    { label: "Failure rate", value: percent(totals.failed, totals.finished) ?? NONE, note: `${totals.failed} of ${totals.finished} finished jobs` },
    {
      label: "Footage kept",
      value: percent(stats.footage.keptS, stats.footage.sourceS) ?? NONE,
      note: `${formatDuration(stats.footage.keptS)} kept of ${formatDuration(stats.footage.sourceS)}`,
    },
  ];
  // Two by two below lg, so rules sit between pairs; one row of four from lg up.
  return (
    <ul aria-label="Summary" className="grid grid-cols-2 border-t border-b border-t-line-strong border-b-line lg:grid-cols-4">
      {cells.map((cell) => (
        <li
          key={cell.label}
          className="flex min-w-0 flex-col gap-1 border-line px-4 pt-4 pb-4.5 max-lg:odd:pl-0 max-lg:even:border-l max-lg:nth-[n+3]:border-t lg:px-5 lg:not-first:border-l lg:first:pl-0"
        >
          <span className="text-ui-sm font-semibold text-copy-muted">{cell.label}</span>
          <span className="text-[1.5rem] leading-tight font-bold tabular-nums font-condensed lg:text-[2rem]">{cell.value}</span>
          <span className="text-ui-sm text-copy-dim">{cell.note}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProjectsByState({ stats }: { readonly stats: Stats }) {
  const largest = Math.max(1, ...stats.projectsByStatus.map((row) => row.count));
  return (
    <Section id="stats-projects" title="Projects by state">
      <ul>
        {stats.projectsByStatus.map(({ status, count }) => (
          <li
            key={status}
            aria-label={`${PROJECT_STATUS_LABELS[status]}: ${count}`}
            className="grid min-h-11 grid-cols-[7rem_1fr_2rem] items-center gap-3 border-b border-line text-ui"
          >
            <span className="text-copy-muted">{PROJECT_STATUS_LABELS[status]}</span>
            <span className="h-2 rounded-pill bg-surface">
              <span className="block h-full rounded-pill bg-accent" style={{ width: `${(count / largest) * 100}%` }} />
            </span>
            <span className="text-right font-bold tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const OUTCOME_BADGES = {
  succeeded: { label: "Finished", Icon: CircleCheck, tone: "border-success text-success" },
  failed: { label: "Failed", Icon: CircleAlert, tone: "border-danger text-danger" },
} as const;

function RenderRow({ job }: { readonly job: StatsJob }) {
  const { label, Icon, tone } = OUTCOME_BADGES[job.outcome];
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-line py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-ui">
        <Badge variant="outline" className={cn("h-auto shrink-0 rounded-pill bg-transparent py-0.5 text-ui-sm font-semibold", tone)}>
          <Icon aria-hidden="true" />
          {label}
        </Badge>
        <span className="truncate font-semibold">{job.projectTitle}</span>
      </span>
      <time dateTime={job.finishedAt} className="text-right text-ui-sm text-copy-dim tabular-nums">
        {formatDateTime(job.finishedAt)}
      </time>
      <span className="col-span-2 text-ui-sm break-words text-copy-muted">
        {`${jobKindLabel(job.kind)} · ${job.outcome === "failed" ? (job.error ?? "No error was recorded.") : `${formatDuration(job.runS)} to run`}`}
      </span>
    </li>
  );
}

export function Renders({ stats }: { readonly stats: Stats }) {
  return (
    <Section id="stats-renders" title="Renders">
      {stats.recentJobs.length === 0 ? (
        <p className="text-ui text-copy-muted">No finished jobs in this range.</p>
      ) : (
        <ul aria-labelledby="stats-renders">
          {stats.recentJobs.map((job) => (
            <RenderRow key={job.jobId} job={job} />
          ))}
        </ul>
      )}
    </Section>
  );
}

const TOKEN_FORMAT = new Intl.NumberFormat("en-US");

export function EditUsage({ stats }: { readonly stats: Stats }) {
  return (
    <Section id="stats-edits" title="Claude use per edit">
      {stats.edits.length === 0 ? (
        <p className="text-ui text-copy-muted">No edits in this range.</p>
      ) : (
        <table aria-labelledby="stats-edits" className="w-full text-ui">
          <thead>
            <tr>
              <th scope="col" className={cn(TABLE_HEAD, "pl-0 text-left")}>
                Edit
              </th>
              <th scope="col" className={cn(TABLE_HEAD, "text-left")}>
                Project
              </th>
              <th scope="col" className={TABLE_HEAD}>
                Turns
              </th>
              <th scope="col" className={cn(TABLE_HEAD, "pr-0")}>
                Tokens
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.edits.map((edit) => (
              <tr key={edit.id}>
                <th scope="row" className={cn(TABLE_CELL, "pl-0 text-left font-normal")}>
                  <time dateTime={edit.startedAt}>{formatDateTime(edit.startedAt)}</time>
                </th>
                <td className={cn(TABLE_CELL, "text-left break-words")}>{edit.projectTitle}</td>
                <td className={TABLE_CELL}>{edit.turns}</td>
                <td className={cn(TABLE_CELL, "pr-0")} title={edit.tokens === null ? undefined : formatTokenCount(edit.tokens)}>
                  {edit.tokens === null ? NONE : TOKEN_FORMAT.format(edit.tokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-ui-sm text-copy-dim">Max plan: token counts only. Studio never shows a dollar figure.</p>
    </Section>
  );
}
