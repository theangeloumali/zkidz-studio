// Created by The Angelo Umali.
import { FolderOpen, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { buttonClass } from "./button-class.ts";

interface DropZoneProps {
  readonly onFiles: (files: File[]) => void;
  readonly onPickInPlace: () => void;
  readonly isBusy?: boolean;
}

const VIDEO_ACCEPT = "video/*,.mkv,.mov,.mp4";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function DropZone({ onFiles, onPickInPlace, isBusy = false }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  usePreventWindowDrop();

  function handleDragOver(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0 && !isBusy) onFiles(files);
  }

  return (
    <section
      aria-labelledby="drop-zone-title"
      data-testid="drop-zone"
      data-dragging={isDragging}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col items-center gap-4 rounded-card border-2 border-dashed border-line-strong bg-bg-elevated px-6 py-12 text-center transition-[border-color,background-color] duration-(--dur-1) ease-out data-[dragging=true]:border-accent data-[dragging=true]:bg-surface sm:py-16"
    >
      <Upload aria-hidden="true" className="size-8 text-accent" strokeWidth={1.75} />
      <h2 id="drop-zone-title" className="font-display text-h3 font-extrabold uppercase font-condensed">
        Drag video files here
      </h2>
      <p className="max-w-[46ch] text-ui text-copy-muted">MP4, MOV or MKV from a phone, camera or screen recording. Files stay on this computer.</p>
      <div className="flex w-full flex-col items-stretch justify-center gap-3 pt-2 sm:w-auto sm:flex-row">
        <button type="button" className={buttonClass("primary")} disabled={isBusy} onClick={() => inputRef.current?.click()}>
          Choose files
        </button>
        <button type="button" className={buttonClass("secondary")} disabled={isBusy} onClick={onPickInPlace}>
          <FolderOpen aria-hidden="true" className="size-4" />
          Use a file in place
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={VIDEO_ACCEPT}
        aria-label="Video files"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </section>
  );
}

/** A file dropped beside the zone would otherwise navigate the tab away from the app. */
function usePreventWindowDrop(): void {
  useEffect(() => {
    const preventDefault = (event: globalThis.DragEvent) => event.preventDefault();
    window.addEventListener("dragover", preventDefault);
    window.addEventListener("drop", preventDefault);
    return () => {
      window.removeEventListener("dragover", preventDefault);
      window.removeEventListener("drop", preventDefault);
    };
  }, []);
}
