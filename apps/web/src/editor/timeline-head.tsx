// Created by The Angelo Umali.
import { ZoomIn, ZoomOut } from "lucide-react";
import type { ReactNode } from "react";
import { buttonClass, ICON_BUTTON_CLASS } from "../components/button-class.ts";

interface TimelineHeadProps {
  readonly meta?: ReactNode;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
}

const LEGEND = [
  { swatch: "sw-seg", label: "Shot" },
  { swatch: "sw-punch", label: "Punch-in" },
  { swatch: "sw-cut", label: "Cut" },
  { swatch: "sw-blur", label: "Blur" },
] as const;

/** Title, edit length, zoom controls (spec §6.2) and the key. At Fit, Fit itself is disabled with Zoom out. */
export function TimelineHead({ meta, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onFit }: TimelineHeadProps) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ui font-semibold">Timeline</h3>
        <div className="flex flex-wrap items-center gap-2">
          {meta}
          <button type="button" className={ICON_BUTTON_CLASS} aria-label="Zoom out" disabled={!canZoomOut} onClick={onZoomOut}>
            <ZoomOut aria-hidden="true" className="size-5" />
          </button>
          <button type="button" className={ICON_BUTTON_CLASS} aria-label="Zoom in" disabled={!canZoomIn} onClick={onZoomIn}>
            <ZoomIn aria-hidden="true" className="size-5" />
          </button>
          <button type="button" className={buttonClass("quiet", "px-3")} disabled={!canZoomOut} onClick={onFit}>
            Fit
          </button>
        </div>
      </div>
      <ul className="legend" aria-label="Timeline key">
        {LEGEND.map(({ swatch, label }) => (
          <li key={label} className="legend-item">
            <span className={`sw ${swatch}`} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </>
  );
}
