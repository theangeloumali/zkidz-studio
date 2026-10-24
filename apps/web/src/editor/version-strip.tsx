// Created by The Angelo Umali.
import { History } from "lucide-react";
import { buttonClass } from "../components/button-class.ts";

interface VersionStripProps {
  readonly latestVersion: number;
  /** The version on screen; null follows the latest. */
  readonly selectedVersion: number | null;
  readonly onSelect: (version: number | null) => void;
  readonly onRestore: (version: number) => void;
  readonly isRestoring: boolean;
}

export function VersionStrip({ latestVersion, selectedVersion, onSelect, onRestore, isRestoring }: VersionStripProps) {
  const shownVersion = selectedVersion ?? latestVersion;
  const versions = Array.from({ length: latestVersion }, (_, position) => position + 1);
  return (
    <div className="versions">
      <span className="inline-flex items-center gap-1 text-ui-sm font-semibold text-copy-muted">
        <History aria-hidden="true" className="size-4" />
        Versions
      </span>
      <ol className="version-list" aria-label="Versions of this edit">
        {versions.map((version) => (
          <li key={version}>
            <button
              type="button"
              className="version font-mono"
              aria-pressed={version === shownVersion}
              aria-current={version === latestVersion ? "true" : undefined}
              onClick={() => onSelect(version === latestVersion ? null : version)}
            >
              v{version}
            </button>
          </li>
        ))}
      </ol>
      {shownVersion !== latestVersion && (
        <button type="button" className={buttonClass("secondary", "min-h-8 px-3 text-ui-sm")} disabled={isRestoring} onClick={() => onRestore(shownVersion)}>
          Restore v{shownVersion}
        </button>
      )}
    </div>
  );
}
