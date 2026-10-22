// Created by The Angelo Umali.
import { API_ROUTES, LastEventIdSchema, StudioEventSchema, type StudioEvent } from "@zks/shared";

/** The slice of EventSource the connector drives, so tests can stand in for it. */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type ConnectionStatus = "connecting" | "live" | "reconnecting";

interface ConnectOptions {
  readonly projectIds: readonly string[];
  readonly onEvent: (event: StudioEvent) => void;
  /** The stream was reopened from scratch, so events may have been missed: refetch. */
  readonly onResync: () => void;
  readonly onStatus?: (status: ConnectionStatus) => void;
  readonly createSource?: (url: string) => EventSourceLike;
}

const EVENT_SOURCE_CLOSED = 2;
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const CURSOR_KEY_PREFIX = "zks.events.after.";

/**
 * While readyState is CONNECTING the browser retries on its own and resends Last-Event-ID.
 * A new EventSource (a reopen, or a page reload) sends none, so it passes the last seen id as
 * `?after=`; only a stream opened without any cursor asks the caller to resync.
 */
export function connectEvents({ projectIds, onEvent, onResync, onStatus, createSource = (url) => new EventSource(url) }: ConnectOptions): () => void {
  let cursor = readStoredCursor(projectIds);
  let source: EventSourceLike | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = FIRST_RETRY_MS;
  let isReopen = false;

  function open(): void {
    onStatus?.(isReopen ? "reconnecting" : "connecting");
    const isResumable = cursor !== null;
    const current = createSource(eventsUrl(projectIds, cursor));
    source = current;
    current.onopen = () => {
      retryMs = FIRST_RETRY_MS;
      onStatus?.("live");
      if (isReopen && !isResumable) onResync();
      isReopen = false;
    };
    current.onmessage = (message) => {
      const eventId = LastEventIdSchema.safeParse(message.lastEventId);
      if (eventId.success) {
        cursor = eventId.data;
        storeCursor(projectIds, cursor);
      }
      const event = parseEvent(message.data);
      if (event) onEvent(event);
    };
    current.onerror = () => {
      onStatus?.("reconnecting");
      if (current.readyState !== EVENT_SOURCE_CLOSED) return;
      current.close();
      isReopen = true;
      retryTimer = setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    };
  }

  open();
  return () => {
    clearTimeout(retryTimer);
    source?.close();
  };
}

function eventsUrl(projectIds: readonly string[], cursor: number | null): string {
  const query = new URLSearchParams(projectIds.map((projectId) => ["project", projectId]));
  if (cursor !== null) query.set("after", String(cursor));
  return `${API_ROUTES.events.path}?${query.toString()}`;
}

/** Event ids are global, so a shared stream may resume only from the oldest cursor of its projects. */
function readStoredCursor(projectIds: readonly string[]): number | null {
  const cursors = projectIds.map((projectId) => LastEventIdSchema.safeParse(readSessionValue(CURSOR_KEY_PREFIX + projectId)));
  if (cursors.length === 0 || !cursors.every((parsed) => parsed.success)) return null;
  return Math.min(...cursors.map((parsed) => parsed.data));
}

function storeCursor(projectIds: readonly string[], cursor: number): void {
  try {
    for (const projectId of projectIds) sessionStorage.setItem(CURSOR_KEY_PREFIX + projectId, String(cursor));
  } catch {
    // Storage blocked (private mode, policy): a reload then resyncs by refetching.
  }
}

function readSessionValue(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseEvent(data: unknown): StudioEvent | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = StudioEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
