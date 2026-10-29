// Created by The Angelo Umali.
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
    <Card className={cn("gap-0 rounded-card bg-bg-elevated py-0 text-copy ring-1", isSelected ? "ring-accent" : "ring-line")}>
      <label className="flex cursor-pointer items-start gap-3 p-5">
        <input type="radio" name="connect-mode" value={value} checked={isSelected} onChange={onSelect} className="mt-1 size-5 shrink-0 accent-accent" />
        {/* Title text sits two levels under the label so jsx-a11y can see the label's name. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-ui-lg font-semibold text-copy">
          {title}
          {badges.map((badge) => (
            <Badge key={badge} variant="outline" className="h-auto rounded-pill border-line-strong text-ui-sm font-semibold text-copy-muted">
              {badge}
            </Badge>
          ))}
          <span className="w-full max-w-[65ch] text-ui font-normal text-copy-muted">{description}</span>
        </span>
      </label>
      {isSelected ? <div className="flex flex-col gap-3 border-t border-line px-5 py-4">{children}</div> : null}
    </Card>
  );
}
