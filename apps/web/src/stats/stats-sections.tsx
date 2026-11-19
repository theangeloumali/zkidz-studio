// Created by The Angelo Umali.
import { formatTokenCount, type Stats } from "@zks/shared";
import { formatDate, formatDuration } from "../lib/format.ts";
import { PROJECT_STATUS_LABELS } from "../lib/project-status.ts";
import { jobKindLabel, jobTotals, percent, weekRows } from "./stats-figures.ts";

const SECTION_TITLE = "font-display text-h3 font-extrabold uppercase font-condensed";
const CARD = "rounded-card border border-line bg-bg-elevated p-5";
const TABLE_HEAD = "border-b border-line pb-2 text-left text-label font-semibold text-copy-muted";
const NUMBER_CELL = "text-right tabular-nums";
const NONE = "–";

function Section({ id, title, children }: { readonly id: string; readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className={SECTION_TITLE}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function StatsLedger({ stats }: { readonly stats: Stats }) {
  const totals = jobTotals(stats);
  const cells = [
    { label: "Jobs", value: String(totals.jobs), note: `${stats.deliverablesByWeek.reduce((total, row) => total + row.count, 0)} deliverables` },
    {
      label: "Median job time",
      value: stats.medianRunS === null ? NONE : formatDuration(stats.medianRunS),
      note: `Waits ${stats.medianQueueWaitS === null ? NONE : formatDuration(stats.medianQueueWaitS)} in the queue`,
    },
    { label: "Failure rate", value: percent(totals.failed, totals.finished) ?? NONE, note: `${totals.failed} of ${totals.finished} finished jobs` },
    {
      label: "Footage kept",
      value: percent(stats.footage.keptS, stats.footage.sourceS) ?? NONE,
      note: `${formatDuration(stats.footage.keptS)} of ${formatDuration(stats.footage.sourceS)}`,
    },
  ];
  return (
    <ul aria-label="Summary" className="grid grid-cols-2 overflow-hidden rounded-card border border-line bg-line gap-px lg:grid-cols-4">
      {cells.map((cell) => (
        <li key={cell.label} className="flex flex-col gap-1 bg-bg-elevated p-5">
          <span className="text-label text-copy-muted">{cell.label}</span>
          <span className="font-display text-h2 font-extrabold tabular-nums font-condensed">{cell.value}</span>
          <span className="text-ui-sm text-copy-muted">{cell.note}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProjectsByState({ stats }: { readonly stats: Stats }) {
  const largest = Math.max(1, ...stats.projectsByStatus.map((row) => row.count));
  return (
    <Section id="stats-projects" title="Projects by state">
      <ul className={`${CARD} flex flex-col gap-3`}>
        {stats.projectsByStatus.map(({ status, count }) => (
          <li key={status} aria-label={`${PROJECT_STATUS_LABELS[status]}: ${count}`} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3">
            <span className="text-ui text-copy-muted">{PROJECT_STATUS_LABELS[status]}</span>
            <span className="h-2 rounded-pill bg-surface">
              <span className="block h-full rounded-pill bg-accent" style={{ width: `${(count / largest) * 100}%` }} />
            </span>
            <span className={`text-ui ${NUMBER_CELL}`}>{count}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function WeeklyActivity({ stats }: { readonly stats: Stats }) {
  const rows = weekRows(stats);
  return (
    <Section id="stats-weeks" title="By week">
      {rows.length === 0 ? (
        <p className="text-ui text-copy-muted">No jobs in this range.</p>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full text-ui">
            <caption className="sr-only">Jobs and deliverables per ISO week</caption>
            <thead>
              <tr>
                <th scope="col" className={TABLE_HEAD}>
                  Week
                </th>
                <th scope="col" className={`${TABLE_HEAD} text-right`}>
                  Jobs
                </th>
                <th scope="col" className={`${TABLE_HEAD} text-right`}>
                  Failed
                </th>
                <th scope="col" className={`${TABLE_HEAD} text-right`}>
                  Deliverables
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.week} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 text-left font-normal tabular-nums">
                    {row.week}
                  </th>
                  <td className={NUMBER_CELL}>{row.jobs}</td>
                  <td className={`${NUMBER_CELL} ${row.failed > 0 ? "text-danger" : ""}`}>{row.failed}</td>
                  <td className={NUMBER_CELL}>{row.deliverables}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function RecentFailures({ stats }: { readonly stats: Stats }) {
  return (
    <Section id="stats-failures" title="Recent failures">
      {stats.failures.length === 0 ? (
        <p className="text-ui text-copy-muted">No failed jobs in this range.</p>
      ) : (
        <ul className={`${CARD} flex flex-col divide-y divide-line py-1`}>
          {stats.failures.map((failure) => (
            <li key={failure.jobId} className="flex flex-col gap-1 py-3">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-ui">
                <span className="font-semibold">
                  {failure.projectTitle} <span className="font-normal text-copy-muted">· {jobKindLabel(failure.kind)}</span>
                </span>
                {failure.finishedAt !== null && <span className="text-ui-sm text-copy-muted">{formatDate(failure.finishedAt)}</span>}
              </span>
              <span className="break-words text-ui-sm text-danger">{failure.error ?? "No error was recorded."}</span>
            </li>
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
      <p className="max-w-prose text-ui text-copy-muted">Input, output and cached tokens each edit reported. Estimates, not billing data.</p>
      {stats.edits.length === 0 ? (
        <p className="text-ui text-copy-muted">No edits in this range.</p>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <table aria-labelledby="stats-edits" className="w-full text-ui">
            <thead>
              <tr>
                <th scope="col" className={TABLE_HEAD}>
                  Edit
                </th>
                <th scope="col" className={`${TABLE_HEAD} text-right`}>
                  Turns
                </th>
                <th scope="col" className={`${TABLE_HEAD} text-right`}>
                  Tokens
                </th>
                <th scope="col" className={`${TABLE_HEAD} text-right`}>
                  Kept
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.edits.map((edit) => (
                <tr key={edit.id} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <span className="block">{edit.projectTitle}</span>
                    <span className="block text-ui-sm text-copy-muted">{formatDate(edit.startedAt)}</span>
                  </th>
                  <td className={NUMBER_CELL}>{edit.turns}</td>
                  <td className={NUMBER_CELL} title={edit.tokens === null ? undefined : formatTokenCount(edit.tokens)}>
                    {edit.tokens === null ? NONE : TOKEN_FORMAT.format(edit.tokens)}
                  </td>
                  <td className={NUMBER_CELL}>{edit.keptPct === null ? NONE : `${Math.round(edit.keptPct)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
