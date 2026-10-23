// Created by The Angelo Umali.
import type { ReactNode } from "react";
import { INLINE_LINK_CLASS } from "./link-class.ts";

export function ExternalLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={INLINE_LINK_CLASS}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
