// Created by The Angelo Umali.
import type { ReactNode } from "react";

export function ExternalLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline underline-offset-2 hover:text-accent-strong">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
