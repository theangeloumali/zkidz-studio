// Created by The Angelo Umali.
import { Check, Copy, Film } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { VIDEO_ACCEPT } from "../components/drop-zone.tsx";
import { UploadList } from "../components/upload-list.tsx";
import { useReferenceUpload } from "./use-reference-upload.ts";

type CopyResult = { readonly sentence: string; readonly isCopied: boolean };

/** One video to match, dropped here or picked; the agent does the matching when asked. */
export function ReferenceSlot({ projectId }: { readonly projectId: string }) {
  const { upload, uploadReference } = useReferenceUpload(projectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const isUploading = upload?.state.kind === "uploading";
  const sentence = upload?.state.kind === "done" ? `match the style of ${upload.name}` : null;

  function accept(file: File | undefined) {
    if (file && !isUploading) void uploadReference(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    accept(event.dataTransfer.files[0]);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyResult({ sentence: text, isCopied: true });
    } catch {
      setCopyResult({ sentence: text, isCopied: false });
    }
  }

  return (
    <div
      data-testid="reference-slot"
      data-dragging={isDragging}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className="flex flex-col gap-3 rounded-card border-2 border-dashed border-line-strong bg-bg-elevated p-4 transition-[border-color,background-color] duration-(--dur-1) ease-out data-[dragging=true]:border-accent data-[dragging=true]:bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-ui font-semibold">Style reference</p>
          <p className="text-ui-sm text-copy-muted">Drop a video whose look you want, or choose one. It is never cut into your edit.</p>
        </div>
        <Button variant="secondary" disabled={isUploading} onClick={() => inputRef.current?.click()}>
          <Film aria-hidden="true" className="size-4" />
          {upload ? "Replace reference" : "Choose reference"}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        aria-label="Style reference video"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          accept(file);
        }}
      />
      {upload?.state.kind === "uploading" && <UploadList items={[upload]} />}
      {upload?.state.kind === "failed" && (
        <p role="alert" className="text-ui-sm text-danger">
          {upload.state.reason}
        </p>
      )}
      {sentence !== null && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 break-words text-ui">Now tell Claude: {sentence}</p>
          <Button variant="quiet" onClick={() => void copy(sentence)}>
            {copyResult?.sentence === sentence && copyResult.isCopied ? (
              <Check aria-hidden="true" className="size-4" />
            ) : (
              <Copy aria-hidden="true" className="size-4" />
            )}
            Copy
          </Button>
          <p aria-live="polite" className="text-ui-sm text-copy-muted">
            {copyResult?.sentence === sentence && (copyResult.isCopied ? "Copied" : "Copy failed. Select the sentence and copy it.")}
          </p>
        </div>
      )}
    </div>
  );
}
