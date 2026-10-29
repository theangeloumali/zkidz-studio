// Created by The Angelo Umali.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { THEME_IDS, ThemeIdSchema, type ProjectStyle } from "@zks/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { mediaQuery } from "../api/queries.ts";
import { FIELD_CLASS } from "../components/field-class.ts";
import { useEventsStore } from "../events/store.ts";
import { ReferenceSlot } from "./reference-slot.tsx";
import { projectStyleQuery, saveProjectStyle, styleQueryKey } from "./style-client.ts";
import { StyleLook, THEME_LABELS } from "./style-look.tsx";
import { latestFinishedStyleToolId } from "./style-tool-events.ts";

const EMPTY_TEXT = "Using the ZKidz look. Drop a reference video and ask Claude to match it.";
const MISSING_REFERENCE_TEXT = "Matched from a reference that is no longer in this project";

/** The agent changes the look through a tool, so its finish is the only signal that the saved style moved. */
function useRefetchWhenAgentRestyles(projectId: string): void {
  const queryClient = useQueryClient();
  const restyleId = useEventsStore((state) => latestFinishedStyleToolId(state.feeds[projectId]?.events ?? []));
  useEffect(() => {
    if (restyleId !== null) void queryClient.invalidateQueries({ queryKey: styleQueryKey(projectId) });
  }, [projectId, queryClient, restyleId]);
}

export function StyleSection({ projectId }: { readonly projectId: string }) {
  const queryClient = useQueryClient();
  const style = useQuery(projectStyleQuery(projectId));
  const media = useQuery(mediaQuery(projectId));
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  useRefetchWhenAgentRestyles(projectId);

  const save = useMutation({
    mutationFn: (next: ProjectStyle | null) => saveProjectStyle(projectId, next),
    onSettled: () => queryClient.invalidateQueries({ queryKey: styleQueryKey(projectId) }),
  });
  const current = style.data ?? null;
  const isBusy = save.isPending || style.isFetching;
  const referenceId = current?.referenceAssetId;
  const referenceName = media.data?.find((asset) => asset.id === referenceId)?.name;

  function switchTheme(value: string) {
    const theme = ThemeIdSchema.safeParse(value);
    if (theme.success) save.mutate({ ...current, theme: theme.data });
  }

  function reset() {
    setIsConfirmingReset(false);
    save.mutate(null);
  }

  return (
    <section aria-labelledby="style-title" className="flex flex-col gap-4">
      <h2 id="style-title" className="text-ui-lg font-semibold">
        Style
      </h2>
      {style.isPending && <p className="text-ui text-copy-muted">Loading style…</p>}
      {style.isError && (
        <p role="alert" className="text-ui text-danger">
          {style.error.message}
        </p>
      )}
      {style.isSuccess && (
        <div className="flex flex-col gap-4 rounded-card border border-line bg-bg-elevated p-4">
          {current === null ? <p className="text-ui text-copy-muted">{EMPTY_TEXT}</p> : <StyleLook style={current} />}
          {referenceId !== undefined && (
            <p className="text-ui-sm text-copy-muted">{referenceName === undefined ? MISSING_REFERENCE_TEXT : `Matched from ${referenceName}`}</p>
          )}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="style-theme" className="text-label font-semibold text-copy">
                Theme
              </label>
              <select
                id="style-theme"
                value={current?.theme ?? THEME_IDS[0]}
                disabled={isBusy}
                onChange={(event) => switchTheme(event.currentTarget.value)}
                className={FIELD_CLASS}
              >
                {THEME_IDS.map((id) => (
                  <option key={id} value={id}>
                    {THEME_LABELS[id]}
                  </option>
                ))}
              </select>
            </div>
            {current !== null && !isConfirmingReset && (
              <Button variant="secondary" disabled={isBusy} onClick={() => setIsConfirmingReset(true)}>
                Reset to the ZKidz look
              </Button>
            )}
            {isConfirmingReset && (
              <div role="group" aria-label="Confirm reset" className="flex flex-wrap items-center gap-3">
                <p className="text-ui">Drop this look and go back to the ZKidz theme?</p>
                <Button variant="steel" onClick={reset}>
                  Yes, reset
                </Button>
                <Button variant="quiet" onClick={() => setIsConfirmingReset(false)}>
                  Keep it
                </Button>
              </div>
            )}
          </div>
          {save.isError && (
            <p role="alert" className="text-ui-sm text-danger">
              {save.error.message}
            </p>
          )}
        </div>
      )}
      <ReferenceSlot projectId={projectId} />
    </section>
  );
}
