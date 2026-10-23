// Created by The Angelo Umali.
import { COST_DISCLAIMER } from "../copy/claude.ts";
import type { SessionSummary } from "./feed-items.ts";

/** Latest turn only, labelled an estimate (plan §6.13); callers omit it in terminal mode. */
export function UsageMeter({ summary }: { readonly summary: SessionSummary }) {
  const utilization = summary.limit?.utilization;
  if (summary.turnCostUsd === null && utilization === undefined) return null;
  const percent = utilization === undefined ? null : Math.round(utilization * 100);
  return (
    <div role="group" aria-label="Usage" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui-sm text-copy-muted">
      <span className="font-semibold">Usage</span>
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
