// Created by The Angelo Umali.
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchTerminalTicket } from "../api/agent-client.ts";
import { buttonClass } from "../components/button-class.ts";
import { TERMINAL_TRUST_HINT } from "../copy/claude.ts";
import { openTerminalConnection, type TerminalStatus } from "./terminal-connection.ts";

const STATUS_TEXT: Record<TerminalStatus, string> = {
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
  exited: "Exited",
};

function toWritable(data: string | ArrayBuffer): string | Uint8Array {
  return typeof data === "string" ? data : new Uint8Array(data);
}

interface TerminalPaneProps {
  readonly sessionId: string;
  readonly onRestart: () => void;
}

/** Prompts and Stop go through the server (it owns the paste encoding); this pane carries the user's own keys. */
export function TerminalPane({ sessionId, onRestart }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TerminalStatus>("connecting");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const terminal = new Terminal({ convertEol: false, cursorBlink: true, fontFamily: "ui-monospace, monospace", fontSize: 13 });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    // Before open(), so xterm never builds its DOM renderer: that one styles cells with <style> elements and style
    // attributes, which the app's style-src 'self' blocks, leaving Claude Code's output uncoloured and off its grid.
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    terminal.loadAddon(webgl);
    terminal.open(host);
    const connection = openTerminalConnection({
      sessionId,
      origin: window.location.origin,
      fetchTicket: fetchTerminalTicket,
      onOutput: (data) => terminal.write(toWritable(data)),
      onStatus: (next) => {
        setStatus(next);
        if (next === "open") connection.resize(terminal.cols, terminal.rows);
      },
    });
    const typing = terminal.onData((data) => connection.sendInput(data));
    const resizing = terminal.onResize(({ cols, rows }) => connection.resize(cols, rows));
    // Hidden tabs measure 0×0; refitting on every size change keeps the PTY grid in step.
    const observer = new ResizeObserver(() => {
      if (host.clientWidth > 0) fit.fit();
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      typing.dispose();
      resizing.dispose();
      connection.close();
      terminal.dispose();
    };
  }, [sessionId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ui-sm text-copy-muted">{TERMINAL_TRUST_HINT}</p>
        <p role="status" className="font-mono text-ui-sm text-copy-muted">
          {STATUS_TEXT[status]}
        </p>
      </div>
      {status === "exited" ? (
        <button type="button" className={buttonClass("secondary", "self-start")} onClick={onRestart}>
          <RotateCcw aria-hidden="true" className="size-4" />
          Restart Claude Code
        </button>
      ) : null}
      {/* The fit addon sizes the grid from the host, so the host has no padding and a fixed height: a box that grows with
          its content made every fit add a row. */}
      <div className="rounded-inset bg-bg p-2">
        <div ref={hostRef} role="application" aria-label="Claude Code terminal" className="h-96 w-full overflow-hidden" />
      </div>
    </div>
  );
}
