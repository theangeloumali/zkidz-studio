// Created by The Angelo Umali.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_ROUTES, CueSheetSchema, CutSpecSchema, keptSpansOf, type PlayerEdl } from "@zks/shared";
import { useEffect, useMemo, useState } from "react";
import { decideCutCandidates, fetchSpecs, restoreSpecVersion, routeUrl, type SpecAddress } from "../api/client.ts";
import { playerEdlQuery, queryKeys, specsQuery, specVersionQuery } from "../api/queries.ts";
import { buttonClass } from "../components/button-class.ts";
import { useEventsStore } from "../events/store.ts";
import { formatDuration } from "../lib/format.ts";
import { CutChips, type CutDecision } from "./cut-chips.tsx";
import { editedDuration, type TimeSpan } from "./edl.ts";
import "./editor.css";
import { createPlaybackClock } from "./playback-clock.ts";
import { PreviewPlayer, type PreviewComposition } from "./preview-player.tsx";
import { Timeline } from "./timeline.tsx";
import { buildTimelineTracks } from "./timeline-items.ts";
import { VersionStrip } from "./version-strip.tsx";

const EMPTY_SPECS: Awaited<ReturnType<typeof fetchSpecs>> = [];
const NO_SPANS: readonly TimeSpan[] = [];

const spansOfEdl = (edl: PlayerEdl): TimeSpan[] => edl.segments.map((segment) => ({ at: segment.sourceAtS, end: segment.sourceEndS }));

// A live preview.ready wins; the EDL's last build covers a page opened after that event went out.
function usePreviewComposition(projectId: string, videoId: string | undefined, builtPreview: PlayerEdl["preview"] | undefined): PreviewComposition | null {
  const events = useEventsStore((state) => state.feeds[projectId]?.events);
  return useMemo(() => {
    const ready = events?.findLast((event) => event.type === "preview.ready" && event.videoId === videoId);
    if (ready?.type === "preview.ready") return { url: ready.compositionUrl, edlVersion: ready.edlVersion };
    return builtPreview ? { url: builtPreview.compositionUrl, edlVersion: builtPreview.edlVersion } : null;
  }, [events, videoId, builtPreview]);
}

function usePendingCutRequest(projectId: string, submittedRequestIds: ReadonlySet<string>) {
  const events = useEventsStore((state) => state.feeds[projectId]?.events);
  return useMemo(() => {
    const proposed = events?.findLast((event) => event.type === "cuts.proposed" && !submittedRequestIds.has(event.requestId));
    return proposed?.type === "cuts.proposed" ? proposed : null;
  }, [events, submittedRequestIds]);
}

/** Preview, timeline and version history for the project's edit, kept live by its event stream. */
export function EditorPanel({ projectId }: { readonly projectId: string }) {
  const queryClient = useQueryClient();
  const specs = useQuery(specsQuery(projectId)).data ?? EMPTY_SPECS;
  const cutsSummary = specs.find((spec) => spec.kind === "cuts");
  const cuesSummary = specs.find((spec) => spec.kind === "cues" && spec.videoId === cutsSummary?.videoId);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const cutsAddress: SpecAddress = { projectId, videoId: cutsSummary?.videoId ?? "", kind: "cuts" };
  const cutsVersion = useQuery({ ...specVersionQuery(cutsAddress, selectedVersion ?? undefined), enabled: cutsSummary !== undefined });
  const cuesVersion = useQuery({ ...specVersionQuery({ projectId, videoId: cuesSummary?.videoId ?? "", kind: "cues" }), enabled: cuesSummary !== undefined });

  const footageUrl = cutsSummary === undefined ? undefined : routeUrl(API_ROUTES.streamProxy.path, { projectId, videoId: cutsSummary.videoId });
  const cuts = useMemo(() => {
    const parsed = CutSpecSchema.safeParse(cutsVersion.data?.content);
    return parsed.success ? parsed.data : null;
  }, [cutsVersion.data]);
  const cueSheet = useMemo(() => {
    const parsed = CueSheetSchema.safeParse(cuesVersion.data?.content);
    return parsed.success ? parsed.data : [];
  }, [cuesVersion.data]);
  // The live version plays the server's EDL (opening it starts the preview build); an older one is only browsed.
  const isLiveVersion = selectedVersion === null && cutsSummary !== undefined;
  const playerEdl = useQuery({
    ...playerEdlQuery(projectId, cutsSummary?.videoId ?? "", cutsSummary?.currentVersion ?? 0),
    enabled: isLiveVersion,
  }).data;
  const spans = useMemo(() => {
    if (isLiveVersion) return playerEdl === undefined ? NO_SPANS : spansOfEdl(playerEdl);
    return cuts === null ? NO_SPANS : keptSpansOf(cuts);
  }, [isLiveVersion, playerEdl, cuts]);
  const tracks = useMemo(() => buildTimelineTracks(cuts, cueSheet), [cuts, cueSheet]);
  const [clock] = useState(() => createPlaybackClock({ durationS: 0 }));
  useEffect(() => () => clock.pause(), [clock]);
  const composition = usePreviewComposition(projectId, cutsSummary?.videoId, playerEdl?.preview);

  const [submittedRequestIds, setSubmittedRequestIds] = useState<ReadonlySet<string>>(new Set());
  const pendingRequest = usePendingCutRequest(projectId, submittedRequestIds);
  const [decisions, setDecisions] = useState<Readonly<Record<string, CutDecision>>>({});
  const submitCuts = useMutation({
    mutationFn: (requestId: string) => {
      const candidateIds = pendingRequest?.candidates.map((candidate) => candidate.id) ?? [];
      // An undecided chip is not a yes: only explicit approvals reach the cut spec.
      const approved = candidateIds.filter((id) => decisions[id] === "approved");
      return decideCutCandidates(projectId, requestId, { approved, rejected: candidateIds.filter((id) => !approved.includes(id)) });
    },
    onSuccess: (_, requestId) => {
      setSubmittedRequestIds((current) => new Set(current).add(requestId));
      setDecisions({});
    },
  });
  const restore = useMutation({
    mutationFn: (version: number) => restoreSpecVersion(cutsAddress, version),
    onSuccess: () => {
      setSelectedVersion(null);
      return queryClient.invalidateQueries({ queryKey: queryKeys.specs(projectId) });
    },
  });

  const decidedCount = Object.keys(decisions).length;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-ui font-semibold">Preview</h3>
          <p className="text-ui-sm text-copy-muted">Live preview · not a render</p>
        </div>
        <PreviewPlayer cuts={cuts} spans={spans} composition={composition} clock={clock} footageUrl={footageUrl} />
      </div>
      <div className="flex flex-col gap-3">
        <Timeline
          tracks={tracks}
          sourceDurationS={cuts?.durationS ?? 0}
          keptSpans={spans}
          clock={clock}
          meta={
            cuts !== null && (
              <p className="font-mono text-ui-sm text-copy-muted tabular-nums">
                Edited · {formatDuration(editedDuration(spans))} (from {formatDuration(cuts.durationS)})
              </p>
            )
          }
          videoLaneExtras={
            pendingRequest !== null && (
              <CutChips
                candidates={pendingRequest.candidates}
                decisions={decisions}
                onDecide={(candidateId, decision) => setDecisions((current) => ({ ...current, [candidateId]: decision }))}
              />
            )
          }
        />
        {pendingRequest !== null && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-ui-sm text-copy-muted" aria-live="polite">
              {decidedCount} of {pendingRequest.candidates.length} proposed cuts decided. Undecided cuts are kept out.
            </p>
            <button
              type="button"
              className={buttonClass("primary", "min-h-8 px-3 text-ui-sm")}
              disabled={submitCuts.isPending}
              onClick={() => submitCuts.mutate(pendingRequest.requestId)}
            >
              Send cut decisions
            </button>
            {submitCuts.isError && (
              <p role="alert" className="text-ui-sm text-danger">
                {submitCuts.error.message}
              </p>
            )}
          </div>
        )}
      </div>
      {cutsSummary !== undefined && (
        <VersionStrip
          latestVersion={cutsSummary.currentVersion}
          selectedVersion={selectedVersion}
          onSelect={setSelectedVersion}
          onRestore={(version) => restore.mutate(version)}
          isRestoring={restore.isPending}
        />
      )}
      {restore.isError && (
        <p role="alert" className="text-ui-sm text-danger">
          {restore.error.message}
        </p>
      )}
    </div>
  );
}
