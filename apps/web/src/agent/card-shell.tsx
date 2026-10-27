// Created by The Angelo Umali.
import { useId, type ReactNode } from "react";

export function CardShell({ title, eyebrow, children }: { readonly title: string; readonly eyebrow: string; readonly children: ReactNode }) {
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-card border border-accent bg-bg-elevated p-4">
      <p className="text-label font-semibold text-copy-muted uppercase">{eyebrow}</p>
      <h3 id={titleId} className="text-ui-lg font-semibold break-words text-copy">
        {title}
      </h3>
      {children}
    </article>
  );
}
