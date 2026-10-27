// Created by The Angelo Umali.
import type { ReactNode } from "react";

interface PanelSectionProps {
  readonly id: string;
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

export function PanelSection({ id, title, action, children }: PanelSectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-card border border-line bg-bg-elevated p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-panel-title font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
