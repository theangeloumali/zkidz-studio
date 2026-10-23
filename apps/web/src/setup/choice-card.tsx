// Created by The Angelo Umali.
import type { ReactNode } from "react";

interface ChoiceCardProps {
  readonly value: string;
  readonly title: string;
  readonly badges: readonly string[];
  readonly description: string;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  /** The card's own controls, shown only while it is the chosen way in. */
  readonly children: ReactNode;
}

export function ChoiceCard({ value, title, badges, description, isSelected, onSelect, children }: ChoiceCardProps) {
  return (
    <div className={`rounded-card border bg-bg-elevated ${isSelected ? "border-accent" : "border-line"}`}>
      <label className="flex cursor-pointer items-start gap-3 p-5">
        <input type="radio" name="connect-mode" value={value} checked={isSelected} onChange={onSelect} className="mt-1 size-5 shrink-0 accent-accent" />
        {/* Title text sits two levels under the label so jsx-a11y can see the label's name. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-ui-lg font-semibold text-copy">
          {title}
          {badges.map((badge) => (
            <span key={badge} className="rounded-pill border border-line-strong px-2 py-0.5 text-ui-sm font-semibold text-copy-muted">
              {badge}
            </span>
          ))}
          <span className="w-full max-w-[65ch] text-ui font-normal text-copy-muted">{description}</span>
        </span>
      </label>
      {isSelected ? <div className="flex flex-col gap-3 border-t border-line px-5 py-4">{children}</div> : null}
    </div>
  );
}
