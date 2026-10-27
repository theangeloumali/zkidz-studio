// Created by The Angelo Umali.
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, FileVideo, Folder, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listFolder } from "../api/client.ts";
import { formatBytes } from "../lib/format.ts";
import { joinPath, parentPath } from "../lib/paths.ts";
import { buttonClass } from "./button-class.ts";

interface InPlacePickerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onPick: (path: string) => void;
}

/** Native <dialog> + showModal gives the focus trap, Escape and focus return for free. */
export function InPlacePicker({ isOpen, onClose, onPick }: InPlacePickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [folder, setFolder] = useState<string | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="picker-title"
      onClose={onClose}
      className="dialog-pop m-auto w-[min(40rem,calc(100vw-2rem))] rounded-card border border-line-strong bg-bg-elevated p-0 text-copy shadow-overlay"
    >
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <h2 id="picker-title" className="text-ui-lg font-semibold">
          Use a file in place
        </h2>
        <button type="button" aria-label="Close" className={buttonClass("quiet", "px-3")} onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>
      <p className="px-5 pt-4 text-ui-sm text-copy-muted">The studio reads the file where it is. Nothing is copied.</p>
      {isOpen && <FolderListing folder={folder} onOpenFolder={setFolder} onPick={onPick} />}
    </dialog>
  );
}

interface FolderListingProps {
  readonly folder: string | undefined;
  readonly onOpenFolder: (path: string) => void;
  readonly onPick: (path: string) => void;
}

function FolderListing({ folder, onOpenFolder, onPick }: FolderListingProps) {
  const listing = useQuery({ queryKey: ["fs", folder ?? ""], queryFn: () => listFolder(folder) });

  if (listing.isPending) return <p className="px-5 py-6 text-ui text-copy-muted">Reading folder…</p>;
  if (listing.isError) {
    return (
      <p role="alert" className="px-5 py-6 text-ui text-danger">
        {listing.error.message}
      </p>
    );
  }

  const { path, entries } = listing.data;
  const parent = parentPath(path);
  return (
    <div className="flex flex-col gap-2 px-5 pt-3 pb-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Up one folder"
          disabled={parent === null}
          className={buttonClass("secondary", "px-3")}
          onClick={() => parent && onOpenFolder(parent)}
        >
          <ArrowUp aria-hidden="true" className="size-4" />
        </button>
        <p className="min-w-0 truncate font-mono text-ui-sm text-copy-muted" title={path}>
          {path}
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="py-6 text-center text-ui text-copy-muted">This folder is empty.</p>
      ) : (
        <ul aria-label={`Contents of ${path}`} className="max-h-[50dvh] overflow-y-auto rounded-inset border border-line">
          {entries.map((entry) => (
            <li key={entry.name} className="border-b border-line last:border-b-0">
              <button
                type="button"
                className="flex min-h-(--target-min) w-full items-center gap-3 px-3 text-left text-ui transition-colors duration-(--dur-hover) hover:bg-surface"
                onClick={() => (entry.isDirectory ? onOpenFolder : onPick)(joinPath(path, entry.name))}
              >
                {entry.isDirectory ? (
                  <Folder aria-hidden="true" className="size-4 shrink-0 text-accent" />
                ) : (
                  <FileVideo aria-hidden="true" className="size-4 shrink-0 text-copy-muted" />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.bytes !== undefined && <span className="shrink-0 font-mono text-ui-sm text-copy-muted tabular-nums">{formatBytes(entry.bytes)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
