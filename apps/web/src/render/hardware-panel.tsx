// Created by The Angelo Umali.
import type { Hardware } from "@zks/shared";
import { PanelSection } from "./panel-section.tsx";

interface HardwarePanelProps {
  /** null when the server has not probed the hardware yet; undefined while loading. */
  readonly hardware: Hardware | null | undefined;
  readonly isUnavailable: boolean;
}

export function HardwarePanel({ hardware, isUnavailable }: HardwarePanelProps) {
  return (
    <PanelSection id="render-hardware" title="Hardware">
      {isUnavailable && <p className="text-ui text-copy-muted">Hardware stats are unavailable.</p>}
      {hardware === null && <p className="text-ui text-copy-muted">The hardware has not been probed yet.</p>}
      {hardware && (
        <ul className="flex flex-col gap-2">
          {hardware.meters.map((meter) => (
            <li key={meter.label} className="grid grid-cols-[6rem_1fr_4.5rem] items-center gap-3 text-ui-sm">
              <span className="text-copy-muted">{meter.label}</span>
              {meter.pct === null ? (
                <span className="col-span-2 text-copy-dim">not used</span>
              ) : (
                <>
                  <div
                    role="meter"
                    aria-label={`${meter.label} utilization`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(meter.pct)}
                    className="h-2 overflow-hidden rounded-pill bg-surface"
                  >
                    <div className="h-full bg-accent transition-[width] duration-(--dur-1) ease-linear" style={{ width: `${meter.pct}%` }} />
                  </div>
                  <span aria-hidden="true" className="text-right font-mono text-copy">
                    {Math.round(meter.pct)}%
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}
