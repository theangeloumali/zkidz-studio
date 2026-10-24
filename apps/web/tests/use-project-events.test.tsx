// Created by The Angelo Umali.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StudioEventType } from "@zks/shared";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queries.ts";
import { useProjectEvents } from "../src/events/use-project-events.ts";
import { renderQueryKeys } from "../src/render/render-api.ts";
import { sampleEvent } from "./event-fixtures.ts";
import { FakeEventSource, PROJECT_ID } from "./fakes.ts";

function connectProjectEvents() {
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useProjectEvents(PROJECT_ID), { wrapper });
  const source = FakeEventSource.instances.at(-1);
  if (!source) throw new Error("no EventSource was opened");
  source.open();
  const invalidatedKeys = () => invalidateQueries.mock.calls.map(([filters]) => filters?.queryKey);
  return { hook, invalidatedKeys, source };
}

describe("useProjectEvents", () => {
  beforeEach(() => {
    FakeEventSource.instances.length = 0;
    sessionStorage.clear();
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it.each<StudioEventType>(["job.queued", "job.started"])("refetches the job list on %s, since its polling stops once every job is idle", (type) => {
    const { hook, invalidatedKeys, source } = connectProjectEvents();

    source.emit(JSON.stringify(sampleEvent(type)), "7");

    expect(invalidatedKeys()).toEqual([renderQueryKeys.jobs(PROJECT_ID)]);
    hook.unmount();
  });

  it("refetches jobs, deliverables, checks and media when a job finishes", () => {
    const { hook, invalidatedKeys, source } = connectProjectEvents();

    source.emit(JSON.stringify(sampleEvent("job.finished")), "8");

    const expected = [renderQueryKeys.jobs(PROJECT_ID), renderQueryKeys.deliverables(PROJECT_ID), renderQueryKeys.qc(PROJECT_ID), queryKeys.media(PROJECT_ID)];
    expect(invalidatedKeys()).toHaveLength(expected.length);
    expect(invalidatedKeys()).toEqual(expect.arrayContaining(expected));
    hook.unmount();
  });
});
