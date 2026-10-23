// Created by The Angelo Umali.
import type { QcCheck } from "@zks/shared";
import { Check, Clock, X, type LucideIcon } from "lucide-react";
import { PanelSection } from "./panel-section.tsx";

const STATUS_LOOK: Readonly<Record<QcCheck["status"], { icon: LucideIcon; iconClass: string; spokenStatus: string }>> = {
  pass: { icon: Check, iconClass: "text-success", spokenStatus: "passed" },
  fail: { icon: X, iconClass: "text-danger", spokenStatus: "failed" },
  pending: { icon: Clock, iconClass: "text-copy-dim", spokenStatus: "waiting" },
};

export function ChecksPanel({ checks }: { readonly checks: readonly QcCheck[] | undefined }) {
  return (
    <PanelSection id="render-checks" title="Checks">
      {checks?.length === 0 && <p className="text-ui text-copy-muted">No checks have run yet.</p>}
      {checks && checks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {checks.map((check) => {
            const { icon: StatusIcon, iconClass, spokenStatus } = STATUS_LOOK[check.status];
            return (
              <li key={check.id} className="flex items-start gap-2 text-ui">
                <StatusIcon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${iconClass}`} />
                <div className="flex flex-col">
                  <span>
                    {check.label}
                    <span className="sr-only"> {spokenStatus}</span>
                  </span>
                  {check.detail && <span className="text-ui-sm text-copy-muted">{check.detail}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}
