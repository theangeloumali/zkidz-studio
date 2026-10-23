// Created by The Angelo Umali.
import type { StageRow, StageState } from "./job-display.ts";

const FILL_CLASS: Readonly<Record<StageState, string>> = {
  done: "bg-success",
  running: "bg-accent",
  failed: "bg-danger",
  waiting: "bg-transparent",
};

/** Width is the only animated property, so a live percent glides instead of jumping. */
export function StageBar({ stage }: { readonly stage: StageRow }) {
  const roundedPct = Math.round(stage.pct);
  return (
    <div className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-ui-sm">
      <span className={stage.state === "waiting" ? "text-copy-dim" : "text-copy-muted"}>{stage.label}</span>
      <div
        role="progressbar"
        aria-label={stage.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedPct}
        className="h-2 overflow-hidden rounded-pill bg-surface"
      >
        <div className={`h-full transition-[width] duration-(--dur-1) ease-linear ${FILL_CLASS[stage.state]}`} style={{ width: `${stage.pct}%` }} />
      </div>
      <span aria-hidden="true" className="text-right font-mono text-copy-dim">
        {roundedPct}%
      </span>
    </div>
  );
}
