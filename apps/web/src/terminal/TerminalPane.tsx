// Created by The Angelo Umali.
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

const EXPANDED_KEY = "zks.terminal.expanded";

// Storage can be blocked or full; the pane works the same without it.
function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(EXPANDED_KEY, String(expanded));
  } catch {
    // Remembering the choice is a convenience only.
  }
}

interface TerminalPaneProps {
  readonly sessionId: string;
  /** The connected agent's product name, e.g. "Codex". */
  readonly agentLabel: string;
  readonly onRestart: () => void;
}

/** Prompts and Stop go through the server (it owns the paste encoding); this pane carries the user's own keys. */
export function TerminalPane({ sessionId, agentLabel, onRestart }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [expanded, setExpanded] = useState(readExpanded);

  useEffect(() => {
    if (!expanded) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  const toggleExpanded = () => {
    writeExpanded(!expanded);
    setExpanded(!expanded);
  };

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

  const ToggleIcon = expanded ? Minimize2 : Maximize2;
  return (
    <div data-testid="terminal-pane" className={cn("flex min-h-0 flex-1 flex-col gap-2", expanded && "fixed inset-0 z-50 overscroll-contain bg-bg p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ui-sm text-copy-muted">{TERMINAL_TRUST_HINT}</p>
        <div className="flex items-center gap-2">
          <p role="status" className="font-mono text-ui-sm text-copy-muted">
            {STATUS_TEXT[status]}
          </p>
          <Button
            type="button"
            variant="quiet"
            size="icon"
            aria-pressed={expanded}
            aria-label={expanded ? "Collapse terminal" : "Expand terminal"}
            onClick={toggleExpanded}
          >
            <ToggleIcon aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>
      {status === "exited" ? (
        <button type="button" className={buttonClass("secondary", "self-start")} onClick={onRestart}>
          <RotateCcw aria-hidden="true" className="size-4" />
          Restart {agentLabel}
        </button>
      ) : null}
      {/* The fit addon sizes the grid from the host, so the host has no padding and a definite height: a box that grows
          with its content made every fit add a row. Expanded, the flex layout gives it the window's height. */}
      <div className={cn("rounded-inset bg-bg p-2", expanded && "flex min-h-0 flex-1 flex-col")}>
        <div
          ref={hostRef}
          role="application"
          aria-label={`${agentLabel} terminal`}
          className={cn("w-full overflow-hidden", expanded ? "min-h-0 flex-1" : "h-96")}
        />
      </div>
    </div>
  );
}
