// Created by The Angelo Umali.
import { useMutation, useQuery } from "@tanstack/react-query";
import { API_ROUTES, type HomeTemplate, type IngestMode } from "@zks/shared";
import { ChevronRight, Clapperboard } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { requestJson } from "../api/client.ts";
import { fetchTemplates, onboardingQueryKeys } from "../api/onboarding-client.ts";
import { editorPath } from "../lib/routes.ts";
import { TemplateDialog } from "./template-dialog.tsx";
import { INGEST_FORMS } from "./templates.ts";

const ROW_CLASS =
  "flex w-full items-center gap-4 rounded-field border border-line bg-bg-elevated p-3 text-left " +
  "transition-[border-color] duration-(--dur-1) ease-out [@media(hover:hover)]:hover:border-line-strong disabled:opacity-50";

function openDemoProject() {
  const { openDemoProject: route } = API_ROUTES;
  return requestJson(route.response, route.path, { method: route.method });
}

/** Home's template list (plan §9.1) plus the demo project, so a fresh install can render without footage. */
export function StartTemplates() {
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: onboardingQueryKeys.templates, queryFn: fetchTemplates });
  const [openTemplate, setOpenTemplate] = useState<HomeTemplate | null>(null);
  const demo = useMutation({ mutationFn: openDemoProject, onSuccess: (project) => navigate(editorPath(project.id)) });

  return (
    <section aria-labelledby="templates-title" className="flex flex-col gap-3">
      <h2 id="templates-title" className="text-ui-lg font-semibold">
        Start from a template
      </h2>
      <ul aria-label="Templates" className="m-0 grid list-none gap-2 p-0">
        {templates.data?.map((template) => (
          <li key={template.id}>
            <button type="button" data-template-id={template.id} className={ROW_CLASS} onClick={() => setOpenTemplate(template)}>
              <TemplateFrame mode={template.ingestMode} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-semibold">{template.name}</span>
                <span className="text-ui-sm text-copy-muted">{template.description}</span>
                <span className="mt-1 block font-mono text-ui-sm text-copy-dim">Ingest: {INGEST_FORMS[template.ingestMode].label}</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-copy-dim" />
            </button>
          </li>
        ))}
      </ul>
      {templates.isError && (
        <p role="alert" className="text-ui text-danger">
          {templates.error.message}
        </p>
      )}
      <button type="button" className={ROW_CLASS} onClick={() => demo.mutate()} disabled={demo.isPending}>
        <Clapperboard aria-hidden="true" className="size-9 shrink-0 p-1.5 text-accent" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-semibold">Try the demo project</span>
          <span className="text-ui-sm text-copy-muted">No footage yet? Open a ready-made clip and render it.</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-copy-dim" />
      </button>
      {demo.isError && (
        <p role="alert" className="text-ui text-danger">
          {demo.error.message}
        </p>
      )}
      <TemplateDialog template={openTemplate} onClose={() => setOpenTemplate(null)} />
    </section>
  );
}

/** [x, y, width, height] of each card block, from the mock-up's template frames. */
const FRAME_CARDS: Record<IngestMode, readonly (readonly [number, number, number, number])[]> = {
  single: [[5, 9, 26, 12]],
  join: [
    [3, 6, 9, 52],
    [13.5, 6, 9, 52],
    [24, 6, 9, 52],
  ],
  showcase: [[4, 10, 28, 18]],
};

/** 9:16 thumbnails from the mock-up: card, subject and caption blocks sketch each template's layout. */
function TemplateFrame({ mode }: { readonly mode: IngestMode }) {
  return (
    <svg viewBox="0 0 36 64" aria-hidden="true" className="w-9 shrink-0">
      <rect width="36" height="64" rx="3" className="fill-surface" />
      {FRAME_CARDS[mode].map(([x, y, width, height]) => (
        <rect key={x} x={x} y={y} width={width} height={height} rx="1.5" className="fill-accent/45" />
      ))}
      {mode !== "join" && (
        <>
          <circle cx="18" cy={mode === "single" ? 36 : 42} r="7" className="fill-line-strong" />
          <rect x="6" y="54" width="24" height="4" rx="1" className="fill-copy" />
        </>
      )}
    </svg>
  );
}
