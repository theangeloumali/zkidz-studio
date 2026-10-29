// Created by The Angelo Umali.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { StudioEvent } from "@zks/shared";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { editFigures, useProjectEdits } from "../../src/edits/edits-client.ts";
import { sampleEvent } from "../event-fixtures.ts";
import { PROJECT_ID, jsonResponse } from "../fakes.ts";
import { stubFetch } from "../render.tsx";
import { FOURTEEN_MINUTES_MS, PROJECT_EDITS_PATH, makeEdit, makeOpenEdit } from "./fixtures.ts";

function renderProjectEdits(events: readonly StudioEvent[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { readonly children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return renderHook(({ feed }) => useProjectEdits(PROJECT_ID, feed), { wrapper, initialProps: { feed: events } });
}

describe("editFigures", () => {
  it("reads a finished edit's duration and every reported total", () => {
    expect(editFigures(makeEdit(), new Date())).toEqual({
      durationMs: FOURTEEN_MINUTES_MS,
      costUsd: 0.62,
      inputTokens: 200_000,
      outputTokens: 10_000,
      cacheTokens: 50_000,
    });
  });

  it("times an open edit up to now and leaves out what was never reported", () => {
    const edit = makeOpenEdit({ costUsd: null, inputTokens: null, outputTokens: null, cacheTokens: null });
    const now = new Date(Date.parse(edit.startedAt) + 60_000);
    expect(editFigures(edit, now)).toEqual({ durationMs: 60_000 });
  });
});

describe("useProjectEdits", () => {
  it("refetches when the stream reports usage or a closed edit, and not for other events", async () => {
    const fetchMock = stubFetch({ [`GET ${PROJECT_EDITS_PATH}`]: () => jsonResponse({ edits: [makeOpenEdit()] }) });
    const editFetches = () => fetchMock.mock.calls.filter(([url]) => url === PROJECT_EDITS_PATH).length;
    const { result, rerender } = renderProjectEdits([]);
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    rerender({ feed: [sampleEvent("narration", { text: "Looking at the takes" })] });
    rerender({ feed: [sampleEvent("usage.reported", { inputTokens: 5 })] });
    await waitFor(() => expect(editFetches()).toBe(2));
    rerender({ feed: [sampleEvent("edit.closed")] });
    await waitFor(() => expect(editFetches()).toBe(3));
  });
});
