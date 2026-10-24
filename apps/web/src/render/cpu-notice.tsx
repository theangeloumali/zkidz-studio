// Created by The Angelo Umali.
import { Info } from "lucide-react";
import { buttonClass } from "../components/button-class.ts";

interface CpuNoticeProps {
  readonly isSending: boolean;
  readonly onRender1080: () => void;
}

export function CpuNotice({ isSending, onRender1080 }: CpuNoticeProps) {
  return (
    <div className="flex items-start gap-3 rounded-field border border-line bg-surface px-4 py-3 text-ui-sm">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="flex flex-col items-start gap-3">
        <p>
          <strong>No hardware encoder found.</strong> CPU rendering works, but 4K takes a long time here. A 1080p master is much faster.
        </p>
        <button type="button" className={buttonClass("secondary")} disabled={isSending} onClick={onRender1080}>
          Render 1080p instead
        </button>
      </div>
    </div>
  );
}
