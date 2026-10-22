// Created by The Angelo Umali.
import { API_ROUTES, StudioEventSchema, type StudioEvent } from "@zks/shared";

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

/**
 * While readyState is CONNECTING the browser retries on its own and resends Last-Event-ID.
 * Once it gives up (CLOSED) a new EventSource starts without a cursor, because the events query
 * accepts only `project`; the reopen therefore asks the caller to resync.
 */
export function connectEvents({ projectIds, onEvent, onResync, onStatus, createSource = (url) => new EventSource(url) }: ConnectOptions): () => void {
  const url = `${API_ROUTES.events.path}?${new URLSearchParams(projectIds.map((projectId) => ["project", projectId])).toString()}`;
  let source: EventSourceLike | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = FIRST_RETRY_MS;
  let isReopen = false;

  function open(): void {
    onStatus?.(isReopen ? "reconnecting" : "connecting");
    const current = createSource(url);
    source = current;
    current.onopen = () => {
      retryMs = FIRST_RETRY_MS;
      onStatus?.("live");
      if (isReopen) onResync();
      isReopen = false;
    };
    current.onmessage = (message) => {
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

function parseEvent(data: unknown): StudioEvent | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = StudioEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
