// Created by The Angelo Umali.
import { Clapperboard } from "lucide-react";

export function RenderRoute() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-h2 font-extrabold uppercase font-condensed">Render</h1>
      <div className="flex items-start gap-4 rounded-card border border-line bg-bg-elevated p-6">
        <Clapperboard aria-hidden="true" className="size-6 shrink-0 text-accent" />
        <p className="max-w-[60ch] text-ui text-copy-muted">The 4K master and Reels cut render here once the edit is ready. Nothing is queued yet.</p>
      </div>
    </div>
  );
}
