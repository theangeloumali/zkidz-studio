// Created by The Angelo Umali.
import { API_ROUTES } from "@zks/shared";
import { ApiError, routeUrl } from "../api/client.ts";

/** The slice of WebSocket the connection drives, so tests can stand in for it. */
export interface SocketLike {
  readonly readyState: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

export type TerminalStatus = "connecting" | "open" | "reconnecting" | "exited" | "closed";

interface TerminalTicket {
  readonly ticket: string;
}

interface TerminalConnectionOptions {
  readonly sessionId: string;
  readonly origin: string;
  readonly fetchTicket: (sessionId: string) => Promise<TerminalTicket>;
  readonly onOutput: (data: string | ArrayBuffer) => void;
  readonly onStatus: (status: TerminalStatus) => void;
  readonly createSocket?: (url: string) => SocketLike;
}

export interface TerminalConnection {
  /** False while the socket is not open, so callers can tell the user the keys went nowhere. */
  sendInput(data: string): boolean;
  resize(cols: number, rows: number): void;
  close(): void;
}

const SOCKET_OPEN = 1;
/** The server closes normally only when the PTY exits (terminal/routes.ts); a drop arrives as 1006. */
const CLOSE_NORMAL = 1000;
const HTTP_NOT_FOUND = 404;
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

function socketUrl(origin: string, sessionId: string, ticket: string): string {
  const url = new URL(routeUrl(API_ROUTES.terminalTicket.path, { sessionId }).replace(/\/ticket$/, "/ws"), origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

/** Tickets are single-use with a 30 s TTL, so every (re)connect fetches a fresh one first. An exited session is not retried. */
export function openTerminalConnection({
  sessionId,
  origin,
  fetchTicket,
  onOutput,
  onStatus,
  createSocket = (url) => new WebSocket(url),
}: TerminalConnectionOptions): TerminalConnection {
  let socket: SocketLike | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = FIRST_RETRY_MS;
  let isClosed = false;

  function markExited(): void {
    isClosed = true;
    onStatus("exited");
  }

  function scheduleRetry(): void {
    if (isClosed) return;
    onStatus("reconnecting");
    retryTimer = setTimeout(() => void connect(false), retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  }

  async function connect(isFirst: boolean): Promise<void> {
    if (isFirst) onStatus("connecting");
    let ticket: TerminalTicket;
    try {
      ticket = await fetchTicket(sessionId);
    } catch (error) {
      if (error instanceof ApiError && error.status === HTTP_NOT_FOUND) markExited();
      else scheduleRetry();
      return;
    }
    if (isClosed) return;
    const current = createSocket(socketUrl(origin, sessionId, ticket.ticket));
    socket = current;
    current.binaryType = "arraybuffer";
    current.onopen = () => {
      retryMs = FIRST_RETRY_MS;
      onStatus("open");
    };
    current.onmessage = (message: MessageEvent<string | ArrayBuffer>) => onOutput(message.data);
    current.onclose = (event) => {
      if (socket === current) socket = null;
      if (event.code === CLOSE_NORMAL && !isClosed) markExited();
      else scheduleRetry();
    };
  }

  function sendFrame(frame: object): boolean {
    if (socket?.readyState !== SOCKET_OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }

  void connect(true);
  return {
    sendInput: (data) => sendFrame({ type: "input", data }),
    resize: (cols, rows) => void sendFrame({ type: "resize", cols, rows }),
    close() {
      isClosed = true;
      clearTimeout(retryTimer);
      socket?.close();
      socket = null;
      onStatus("closed");
    },
  };
}
