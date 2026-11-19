// Created by The Angelo Umali.
import { Button } from "@/components/ui/button";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { STATS_RANGES, type StatsRange } from "@zks/shared";
import { Scissors } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../api/client.ts";
import { buttonClass } from "../components/button-class.ts";
import { ROUTE_PATHS } from "../lib/routes.ts";
import { statsQuery } from "./stats-client.ts";
import { EditUsage, ProjectsByState, Renders, StatsLedger } from "./stats-sections.tsx";

const RANGE_LABELS: Record<StatsRange, string> = { "7d": "7 days", "30d": "30 days", all: "All" };

export function StatsRoute() {
  const [range, setRange] = useState<StatsRange>("30d");
  const stats = useQuery({ ...statsQuery(range), placeholderData: keepPreviousData });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <h1 className="font-display text-[2.25rem] leading-none font-extrabold uppercase font-condensed">Stats</h1>
        {stats.data?.hasAnyEdit === true && <RangePicker range={range} onChange={setRange} />}
        <p className="basis-full text-ui text-copy-muted">Every project, job and edit on this machine.</p>
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
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <div className="flex min-w-0 flex-col gap-10">
              <ProjectsByState stats={stats.data} />
              <Renders stats={stats.data} />
            </div>
            <EditUsage stats={stats.data} />
          </div>
        </div>
      )}
    </div>
  );
}

function RangePicker({ range, onChange }: { readonly range: StatsRange; readonly onChange: (range: StatsRange) => void }) {
  return (
    <div role="group" aria-label="Range" className="flex w-full gap-1 rounded-control border border-line p-1 sm:ml-auto sm:w-auto">
      {STATS_RANGES.map((option) => (
        <Button
          key={option}
          variant={option === range ? "steel" : "quiet"}
          className="flex-1 px-4 sm:flex-none"
          aria-pressed={option === range}
          onClick={() => onChange(option)}
        >
          {RANGE_LABELS[option]}
        </Button>
      ))}
    </div>
  );
}

function EmptyStats() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Scissors aria-hidden="true" className="size-8 text-copy-dim" />
      <div className="flex flex-col gap-3">
        <p className="text-ui font-bold">No edits yet.</p>
        <p className="text-ui text-copy-muted">Stats fill in as you edit.</p>
      </div>
      <Link to={ROUTE_PATHS.home} className={buttonClass("primary")}>
        Open a project
      </Link>
    </div>
  );
}
