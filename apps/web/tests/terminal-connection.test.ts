// Created by The Angelo Umali.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client.ts";
import { openTerminalConnection, type SocketLike, type TerminalStatus } from "../src/terminal/terminal-connection.ts";

class FakeSocket implements SocketLike {
  static readonly instances: FakeSocket[] = [];
  readonly sent: string[] = [];
  readyState = 0;
  binaryType: BinaryType = "blob";
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  isClosed = false;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.isClosed = true;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  /** 1006 is a dropped connection; the server closes with 1000 only once the terminal has exited. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close", { code }));
  }
}

describe("openTerminalConnection", () => {
  let tickets = 0;
  const fetchTicket = vi.fn(() => {
    tickets += 1;
    return Promise.resolve({ ticket: `ticket-${String(tickets).padStart(32, "0")}`, expiresAt: "2026-10-23T10:00:30.000Z" });
  });

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances.length = 0;
    tickets = 0;
    fetchTicket.mockClear();
  });

  afterEach(() => vi.useRealTimers());

  function open(onOutput = vi.fn(), statuses: TerminalStatus[] = []) {
    const connection = openTerminalConnection({
      sessionId: "sess 1",
      origin: "http://127.0.0.1:4317",
      fetchTicket,
      createSocket: (url) => new FakeSocket(url),
      onOutput,
      onStatus: (status) => statuses.push(status),
    });
    return { connection, onOutput, statuses };
  }

  it("fetches a ticket, then opens the socket with it on the ws scheme", async () => {
    const { statuses } = open();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));

    expect(fetchTicket).toHaveBeenCalledWith("sess 1");
    expect(FakeSocket.instances[0]?.url).toBe(`ws://127.0.0.1:4317/api/terminal/sess%201/ws?ticket=ticket-${"1".padStart(32, "0")}`);
    FakeSocket.instances[0]?.open();
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("sends keys and resizes as JSON frames and passes output through", async () => {
    const { connection, onOutput } = open();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0] as FakeSocket;
    socket.open();

    expect(connection.sendInput("y")).toBe(true);
    connection.resize(120, 40);
    socket.onmessage?.(new MessageEvent("message", { data: "hello" }));

    expect(socket.sent).toEqual([JSON.stringify({ type: "input", data: "y" }), JSON.stringify({ type: "resize", cols: 120, rows: 40 })]);
    expect(onOutput).toHaveBeenCalledWith("hello");
  });

  it("refuses input while the socket is not open", () => {
    const { connection } = open();
    expect(connection.sendInput("y")).toBe(false);
  });

  it("reconnects with a fresh ticket after the socket drops", async () => {
    const { statuses } = open();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.instances[0]?.open();
    FakeSocket.instances[0]?.drop();
    expect(statuses.at(-1)).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    expect(fetchTicket).toHaveBeenCalledTimes(2);
    expect(FakeSocket.instances[1]?.url).toContain(`ticket-${"2".padStart(32, "0")}`);
  });

  it("stops reconnecting once closed", async () => {
    const { connection, statuses } = open();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    connection.close();
    FakeSocket.instances[0]?.drop();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]?.isClosed).toBe(true);
    expect(statuses.at(-1)).toBe("closed");
  });

  it("retries when the ticket request fails", async () => {
    fetchTicket.mockRejectedValueOnce(new Error("offline"));
    const { statuses } = open();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("reconnecting"));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  });

  it("shows exited and stops retrying when the session is gone", async () => {
    fetchTicket.mockRejectedValueOnce(new ApiError("Not found", 404));
    const { statuses } = open();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("exited"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchTicket).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("shows exited without reconnecting when the server closes after the terminal exits", async () => {
    const { statuses } = open();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.instances[0]?.open();
    FakeSocket.instances[0]?.drop(1000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(statuses.at(-1)).toBe("exited");
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
