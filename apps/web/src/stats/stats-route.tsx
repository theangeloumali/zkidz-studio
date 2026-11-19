// Created by The Angelo Umali.
import { Button } from "@/components/ui/button";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { STATS_RANGES, type StatsRange } from "@zks/shared";
import { useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../api/client.ts";
import { buttonClass } from "../components/button-class.ts";
import { ROUTE_PATHS } from "../lib/routes.ts";
import { statsQuery } from "./stats-client.ts";
import { EditUsage, ProjectsByState, RecentFailures, StatsLedger, WeeklyActivity } from "./stats-sections.tsx";

const RANGE_LABELS: Record<StatsRange, string> = { "7d": "7 days", "30d": "30 days", all: "All" };

export function StatsRoute() {
  const [range, setRange] = useState<StatsRange>("30d");
  const stats = useQuery({ ...statsQuery(range), placeholderData: keepPreviousData });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-h2 font-extrabold uppercase font-condensed">Stats</h1>
          <p className="text-lede text-copy-muted">What Studio ran, kept and spent on this machine.</p>
        </div>
        {stats.data?.hasAnyEdit === true && <RangePicker range={range} onChange={setRange} />}
      </header>
      {stats.isPending && (
        <p role="status" className="text-ui text-copy-muted">
          Loading stats…
        </p>
      )}
      {stats.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-ui">
          <span className="text-danger">
            Stats did not load. {stats.error instanceof ApiError ? stats.error.message : "The server sent an answer this page cannot read."}
          </span>
          <Button onClick={() => void stats.refetch()}>Try again</Button>
        </div>
      )}
      {stats.data?.hasAnyEdit === false && <EmptyStats />}
      {stats.data?.hasAnyEdit === true && (
        <div className="flex flex-col gap-10" aria-busy={stats.isPlaceholderData}>
          <StatsLedger stats={stats.data} />
          <div className="grid gap-10 lg:grid-cols-2">
            <ProjectsByState stats={stats.data} />
            <WeeklyActivity stats={stats.data} />
          </div>
          <EditUsage stats={stats.data} />
          <RecentFailures stats={stats.data} />
        </div>
      )}
    </div>
  );
}

function RangePicker({ range, onChange }: { readonly range: StatsRange; readonly onChange: (range: StatsRange) => void }) {
  return (
    <div role="group" aria-label="Range" className="flex gap-1 rounded-control border border-line p-1">
      {STATS_RANGES.map((option) => (
        <Button key={option} variant={option === range ? "steel" : "quiet"} className="px-4" aria-pressed={option === range} onClick={() => onChange(option)}>
          {RANGE_LABELS[option]}
        </Button>
      ))}
    </div>
  );
}

function EmptyStats() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-card border border-line bg-bg-elevated p-8">
      <div className="flex flex-col gap-1">
        <p className="text-h3 font-semibold">No edits yet.</p>
        <p className="text-ui text-copy-muted">Stats fill in as you edit.</p>
      </div>
      <Link to={ROUTE_PATHS.home} className={buttonClass("secondary")}>
        Open a project
      </Link>
    </div>
  );
}
