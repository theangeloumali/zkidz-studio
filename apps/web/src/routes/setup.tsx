// Created by The Angelo Umali.
import { Wrench } from "lucide-react";

export function SetupRoute() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-h2 font-extrabold uppercase font-condensed">Setup</h1>
      <div className="flex items-start gap-4 rounded-card border border-line bg-bg-elevated p-6">
        <Wrench aria-hidden="true" className="size-6 shrink-0 text-accent" />
        <p className="max-w-[60ch] text-ui text-copy-muted">Machine checks for ffmpeg, the GPU, Chrome and the whisper models will show here.</p>
      </div>
    </div>
  );
}
