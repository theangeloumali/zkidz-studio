// Created by The Angelo Umali.
import { useId, type KeyboardEvent, type ReactNode } from "react";

export type PaneTab = "activity" | "terminal";
const TABS: readonly { id: PaneTab; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "terminal", label: "Terminal" },
];

interface PaneTabsProps {
  readonly active: PaneTab;
  readonly onSelect: (tab: PaneTab) => void;
  /** Both panels stay mounted so the terminal keeps its socket and scrollback while hidden. */
  readonly panels: Readonly<Record<PaneTab, ReactNode>>;
}

export function PaneTabs({ active, onSelect, panels }: PaneTabsProps) {
  const baseId = useId();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = active === "activity" ? "terminal" : "activity";
    onSelect(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div role="tablist" aria-label="Agent views" className="flex gap-1 border-b border-line">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`${baseId}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={onKeyDown}
            className={`min-h-(--target-min) border-b-2 px-4 text-ui font-semibold ${active === tab.id ? "border-accent text-copy" : "border-transparent text-copy-muted hover:text-copy"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={active !== tab.id}
          className="flex min-h-0 flex-1 flex-col"
        >
          {panels[tab.id]}
        </div>
      ))}
    </div>
  );
}
