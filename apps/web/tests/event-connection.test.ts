// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectEvents } from "../src/events/connection.ts";
import { FakeEventSource, PROJECT_ID } from "./fakes.ts";

function latestSource(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (!source) throw new Error("no EventSource was opened");
  return source;
}

describe("connectEvents", () => {
  const onEvent = vi.fn<(event: StudioEvent) => void>();
  const onResync = vi.fn<() => void>();
  const onStatus = vi.fn<(status: string) => void>();
  let disconnect: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances.length = 0;
    onEvent.mockReset();
    onResync.mockReset();
    onStatus.mockReset();
    disconnect = connectEvents({ projectIds: [PROJECT_ID], onEvent, onResync, onStatus, createSource: (url) => new FakeEventSource(url) });
  });

  afterEach(() => disconnect());

  it("subscribes to the project's events", () => {
    expect(latestSource().url).toBe(`/api/events?project=${PROJECT_ID}`);
  });

  it("delivers valid events and skips malformed ones", () => {
    latestSource().emit("{not json");
    latestSource().emit(JSON.stringify({ type: "nope" }));
    latestSource().emit(JSON.stringify({ type: "narration", projectId: PROJECT_ID, at: "2026-10-21T10:00:00.000Z", text: "Cutting", id: 3 }));

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ type: "narration", id: 3 });
  });

  it("leaves a transient drop to the browser, which resends Last-Event-ID itself", () => {
    latestSource().error(0);
    vi.advanceTimersByTime(60_000);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(onStatus).toHaveBeenLastCalledWith("reconnecting");
  });

  it("reopens a closed stream with backoff and asks for a resync, since the cursor is lost", () => {
    latestSource().open();
    latestSource().error(2);
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(onResync).not.toHaveBeenCalled();

    latestSource().open();
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith("live");
  });

  it("doubles the wait after each failed reopen", () => {
    latestSource().error(2);
    vi.advanceTimersByTime(1_000);
    latestSource().error(2);
    vi.advanceTimersByTime(1_999);
    expect(FakeEventSource.instances).toHaveLength(2);

    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it("stops reconnecting once disconnected", () => {
    latestSource().error(2);
    disconnect();
    vi.advanceTimersByTime(60_000);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latestSource().isClosed).toBe(true);
  });
});
