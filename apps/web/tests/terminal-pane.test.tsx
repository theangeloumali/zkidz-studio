// Created by The Angelo Umali.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPane } from "../src/terminal/TerminalPane.tsx";
import { jsonResponse } from "./fakes.ts";
import { stubFetch } from "./render.tsx";

const xterm = vi.hoisted(() => ({ written: [] as unknown[], onData: null as ((data: string) => void) | null, opened: 0, steps: [] as string[] }));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon(addon: object): void {
      xterm.steps.push(addon.constructor.name);
    }
    open(): void {
      xterm.opened += 1;
      xterm.steps.push("open");
    }
    write(data: unknown): void {
      xterm.written.push(data);
    }
    onData(listener: (data: string) => void) {
      xterm.onData = listener;
      return { dispose: () => undefined };
    }
    onResize() {
      return { dispose: () => undefined };
    }
    focus(): void {}
    dispose(): void {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddon {
    fit(): void {}
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class WebglAddon {
    onContextLoss() {
      return { dispose: () => undefined };
    }
    dispose(): void {}
  },
}));

class FakeSocket {
  static latest: FakeSocket | null = null;
  readonly sent: string[] = [];
  readyState = 0;
  binaryType: BinaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.latest = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {}
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
}

const TICKET = "t".repeat(32);

function renderPane(ticketStatus = 200) {
  stubFetch({
    "GET /api/projects": () => jsonResponse({ projects: [] }),
    "POST /api/terminal/sess-1/ticket": () =>
      ticketStatus === 200 ? jsonResponse({ ticket: TICKET, expiresAt: "2026-10-23T10:00:30.000Z" }) : jsonResponse({ error: "Not found" }, ticketStatus),
  });
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  const onRestart = vi.fn();
  render(<TerminalPane sessionId="sess-1" onRestart={onRestart} />);
  return { onRestart };
}

async function renderOpenPane() {
  renderPane();
  await waitFor(() => expect(FakeSocket.latest?.url).toContain(`ticket=${TICKET}`));
  FakeSocket.latest?.open();
  return { socket: FakeSocket.latest as FakeSocket };
}

describe("TerminalPane", () => {
  beforeEach(() => {
    FakeSocket.latest = null;
    xterm.written.length = 0;
    xterm.onData = null;
    xterm.opened = 0;
  });

  // The app's style-src 'self' blocks the DOM renderer's <style> elements and style attributes; WebGL draws on a canvas.
  it("loads the WebGL renderer before it opens the terminal", async () => {
    xterm.steps = [];
    renderPane();
    await waitFor(() => expect(xterm.steps).toContain("open"));
    expect(xterm.steps.indexOf("WebglAddon")).toBeGreaterThanOrEqual(0);
    expect(xterm.steps.indexOf("WebglAddon")).toBeLessThan(xterm.steps.indexOf("open"));
  });

  it("opens the terminal, then the socket with a fresh ticket, and writes its output", async () => {
    const { socket } = await renderOpenPane();
    expect(xterm.opened).toBe(1);
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    socket.onmessage?.(new MessageEvent("message", { data: "hello" }));
    expect(xterm.written).toContain("hello");
  });

  it("sends typed keys as input frames", async () => {
    const { socket } = await renderOpenPane();
    xterm.onData?.("y");
    expect(socket.sent).toContain(JSON.stringify({ type: "input", data: "y" }));
  });

  it("shows Claude Code's folder-trust dialog as soon as the PTY prints it", async () => {
    const { socket } = await renderOpenPane();
    const trustDialog = "Do you trust the files in this folder?\r\n❯ 1. No, exit\r\n  2. Yes, I trust this folder";
    socket.onmessage?.(new MessageEvent("message", { data: trustDialog }));
    expect(xterm.written).toContain(trustDialog);
  });

  it("offers Restart once the terminal has exited", async () => {
    const { onRestart } = renderPane(404);
    expect(await screen.findByText("Exited")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restart Claude Code" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  // The fit addon sizes the grid from this element; padding or a content-driven height made every fit add a row, forever.
  it("measures the terminal on a fixed-height box with no padding", () => {
    renderPane();
    const host = screen.getByRole("application", { name: "Claude Code terminal" });
    expect(host.className).not.toMatch(/(^|\s)(p|px|py|pt|pb)-/);
    expect(host.className).toMatch(/(^|\s)h-\d+/);
    expect(host.className).not.toMatch(/(^|\s)(flex-1|min-h-)/);
  });

  it("shows the folder-trust hint", async () => {
    await renderOpenPane();
    expect(screen.getByText(/trust/i)).toBeInTheDocument();
  });
});
