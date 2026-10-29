// Created by The Angelo Umali.
import type { EditSummary } from "@zks/shared";
import { useEffect, useState } from "react";
import type { Connection } from "../api/agent-client.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COST_DISCLAIMER } from "../copy/claude.ts";
import { editFigures } from "../edits/edits-client.ts";
import { formatUsage } from "../lib/format.ts";
import type { SessionSummary } from "./feed-items.ts";

const PLAN_PRICING_NOTE = "What you pay depends on your plan.";
const CLOCK_TICK_MS = 60_000;

interface UsageMeterProps {
  readonly summary: SessionSummary;
  readonly mode: NonNullable<Connection["mode"]>;
  readonly openEdit: EditSummary | undefined;
}

/** The open edit's running totals in every mode, plus the latest turn's cost; each figure is an estimate (plan §6.13, reversed by the owner). */
export function UsageMeter({ summary, mode, openEdit }: UsageMeterProps) {
  const now = useClock(openEdit !== undefined);
  const utilization = summary.limit?.utilization;
  if (openEdit === undefined && summary.turnCostUsd === null && utilization === undefined) return null;
  const percent = utilization === undefined ? null : Math.round(utilization * 100);
  // Terminal mode is the one where the user signs in with a Claude plan instead of paying per token.
  const costNote = mode === "terminal" ? `${COST_DISCLAIMER} ${PLAN_PRICING_NOTE}` : COST_DISCLAIMER;
  return (
    <div role="group" aria-label="Usage" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui-sm text-copy-muted">
      <span className="font-semibold">Usage</span>
      {openEdit !== undefined ? (
        <Tooltip>
          <TooltipTrigger className="cursor-help font-mono tabular-nums underline decoration-dotted underline-offset-4">
            {`This edit · ${formatUsage(editFigures(openEdit, now))}`}
          </TooltipTrigger>
          <TooltipContent>{costNote}</TooltipContent>
        </Tooltip>
      ) : null}
      {summary.turnCostUsd !== null ? (
        <span className="font-mono tabular-nums" title={COST_DISCLAIMER}>
          ≈ ${summary.turnCostUsd.toFixed(2)} this turn (estimate)
        </span>
      ) : null}
      {percent !== null ? (
        <span className="flex items-center gap-2">
          <span
            role="meter"
            aria-label="Plan limit used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-24 overflow-hidden rounded-pill bg-surface"
          >
            <span className={`block h-full ${percent >= 90 ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.min(percent, 100)}%` }} />
          </span>
          <span className="font-mono tabular-nums">{percent}% of plan limit</span>
        </span>
      ) : null}
    </div>
  );
}

/** Re-renders each minute while an edit is open, so its duration keeps up between events. */
function useClock(isRunning: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!isRunning) return undefined;
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [isRunning]);
  return now;
}
