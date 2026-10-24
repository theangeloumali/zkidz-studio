// Created by The Angelo Umali.
import { buttonClass } from "../components/button-class.ts";
import { RENDER_TARGET_OPTIONS, type RenderTargetId } from "./render-request.ts";

interface TargetPickerProps {
  readonly selectedIds: readonly RenderTargetId[];
  readonly isSending: boolean;
  readonly onToggle: (targetId: RenderTargetId, isSelected: boolean) => void;
  readonly onRender: () => void;
}

export function TargetPicker({ selectedIds, isSending, onToggle, onRender }: TargetPickerProps) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <legend className="float-left mr-2 text-label text-copy-muted">Render</legend>
      {RENDER_TARGET_OPTIONS.map((option) => (
        <label key={option.id} className="flex min-h-(--target-min) cursor-pointer items-center gap-3 text-ui text-copy">
          <input
            type="checkbox"
            checked={selectedIds.includes(option.id)}
            onChange={(changeEvent) => onToggle(option.id, changeEvent.currentTarget.checked)}
            className="size-5 shrink-0 accent-accent"
          />
          {option.label}
        </label>
      ))}
      <button type="button" className={buttonClass("secondary")} disabled={selectedIds.length === 0 || isSending} onClick={onRender}>
        Render selected
      </button>
    </fieldset>
  );
}
