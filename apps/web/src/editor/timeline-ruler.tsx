// Created by The Angelo Umali.
import type { KeyboardEvent, RefObject } from "react";
import { formatDuration } from "../lib/format.ts";

interface TimelineRulerProps {
  readonly sliderRef: RefObject<HTMLDivElement | null>;
  readonly ticks: readonly number[];
  readonly pixelsPerSecond: number;
  readonly editedLengthS: number;
  readonly valueS: number;
  readonly valueText: string;
  readonly disabled: boolean;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** The ruler is the Playhead slider (spec §7): the lanes hold the cut chips' buttons, and a slider cannot contain controls. */
export function TimelineRuler({ sliderRef, ticks, pixelsPerSecond, editedLengthS, valueS, valueText, disabled, onKeyDown }: TimelineRulerProps) {
  return (
    <div className="ruler-row">
      <span className="track-label" aria-hidden="true" />
      <div
        ref={sliderRef}
        className="ruler"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={editedLengthS}
        aria-valuenow={valueS}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
      >
        {ticks.map((tickS) => (
          <span key={tickS} className="tick" style={{ left: tickS * pixelsPerSecond }} aria-hidden="true">
            {formatDuration(tickS)}
          </span>
        ))}
      </div>
    </div>
  );
}
