// Created by The Angelo Umali.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { HomeTemplate } from "@zks/shared";
import { queryKeys } from "../api/queries.ts";
import { buttonClass } from "../components/button-class.ts";
import { FIELD_CLASS } from "../components/field-class.ts";
import { INLINE_LINK_CLASS } from "../components/link-class.ts";
import { ROUTE_PATHS, editorPath } from "../lib/routes.ts";
import { NotConnectedError, startFromTemplate } from "./start-from-template.ts";
import { INGEST_FORMS, type FileSlot } from "./templates.ts";

interface TemplateDialogProps {
  readonly template: HomeTemplate | null;
  readonly onClose: () => void;
}

/** Native <dialog> + showModal, as InPlacePicker: focus trap, Escape and focus return come free. */
export function TemplateDialog({ template, onClose }: TemplateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (template && !dialog.open) dialog.showModal();
    if (!template && dialog.open) dialog.close();
  }, [template]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="template-title"
      onClose={onClose}
      className="dialog-pop m-auto w-[min(36rem,calc(100vw-2rem))] rounded-card border border-line-strong bg-bg-elevated p-0 text-copy shadow-overlay"
    >
      {/* Keyed so each opening starts with that template's prompt and no leftover files. */}
      {template && <TemplateForm key={template.id} template={template} onClose={onClose} />}
    </dialog>
  );
}

interface TemplateFormProps {
  readonly template: HomeTemplate;
  readonly onClose: () => void;
}

function TemplateForm({ template, onClose }: TemplateFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = INGEST_FORMS[template.ingestMode];
  const [prompt, setPrompt] = useState(template.prompt);
  const [filesBySlot, setFilesBySlot] = useState<Readonly<Record<string, readonly File[]>>>({});
  const [missing, setMissing] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: startFromTemplate,
    onSuccess: (project) => navigate(editorPath(project.id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const emptySlot = form.slots.find((slot) => (filesBySlot[slot.id] ?? []).length === 0);
    setMissing(emptySlot?.missingMessage ?? null);
    if (emptySlot) return;
    const uploads = form.slots.flatMap((slot) => (filesBySlot[slot.id] ?? []).map((file) => ({ file, role: slot.role })));
    start.mutate({ template, uploads, prompt });
  }

  const errorText = missing ?? (start.isError ? start.error.message : null);
  return (
    <form onSubmit={submit} className="flex flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <h2 id="template-title" className="text-ui-lg font-semibold">
          {template.name}
        </h2>
        <button type="button" aria-label="Close" className={buttonClass("quiet", "px-3")} onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="font-mono text-ui-sm text-copy-muted">Ingest: {form.label}</p>
        {form.slots.map((slot) => (
          <SlotInput key={slot.id} slot={slot} onFiles={(files) => setFilesBySlot((current) => ({ ...current, [slot.id]: files }))} />
        ))}
        <div className="flex flex-col gap-2">
          <label htmlFor="template-prompt" className="text-ui font-semibold">
            Prompt
          </label>
          <textarea id="template-prompt" rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} className={`${FIELD_CLASS} py-2`} />
        </div>
        {errorText && (
          <p role="alert" className="text-ui text-danger">
            {errorText}
            {!missing && start.error instanceof NotConnectedError && (
              <>
                {" "}
                <Link to={ROUTE_PATHS.setup} className={INLINE_LINK_CLASS}>
                  Open Setup
                </Link>
              </>
            )}
          </p>
        )}
      </div>
      <footer className="flex justify-end gap-3 border-t border-line px-5 py-4">
        <button type="button" className={buttonClass("secondary")} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={buttonClass("steel")} disabled={start.isPending}>
          {start.isPending ? "Uploading…" : "Start the edit"}
        </button>
      </footer>
    </form>
  );
}

interface SlotInputProps {
  readonly slot: FileSlot;
  readonly onFiles: (files: readonly File[]) => void;
}

function SlotInput({ slot, onFiles }: SlotInputProps) {
  const inputId = `template-file-${slot.id}`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-ui font-semibold">
        {slot.label}
      </label>
      <input
        id={inputId}
        type="file"
        accept="video/*"
        multiple={slot.isMultiple}
        onChange={(event) => onFiles(Array.from(event.target.files ?? []))}
        className="text-ui text-copy-muted file:mr-3 file:min-h-(--target-min) file:rounded-control file:border file:border-line-strong file:bg-transparent file:px-4 file:text-ui file:font-semibold file:text-copy"
      />
    </div>
  );
}
