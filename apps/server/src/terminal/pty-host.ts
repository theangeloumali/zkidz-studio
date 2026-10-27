// Created by The Angelo Umali.
// Mode T PTY host (plan §6.3): argv-only spawn of the resolved claude, never a shell, never a credential in the env.
import { isAbsolute } from "node:path";
import type * as nodePty from "node-pty";
import { lazyImport } from "../lazy-import.ts";
import { createOutputRing, OUTPUT_RING_BYTES } from "./output-ring.ts";
import { INTERRUPT_KEY } from "./prompt-input.ts";
import { findCredentialVariable } from "./terminal-env.ts";

/** Plan §5.2: at most two live terminals per machine. */
const MAX_TERMINAL_SESSIONS = 2;
const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 32;
const loadNodePty = lazyImport("node-pty", () => import("node-pty"));

export type TerminalLaunchFailure = "claude_missing" | "wrong_binary" | "credential_env" | "session_cap" | "duplicate_session";

export class TerminalLaunchError extends Error {
  readonly reason: TerminalLaunchFailure;

  constructor(reason: TerminalLaunchFailure, message: string) {
    super(message);
    this.name = "TerminalLaunchError";
    this.reason = reason;
  }
}

interface PtyLaunch {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly columns?: number;
  readonly rows?: number;
}

export interface TerminalPty {
  readonly sessionId: string;
  write(input: string): void;
  resize(columns: number, rows: number): void;
  interrupt(): void;
  kill(): void;
  /** Recent output, replayed to a tab that reconnects. */
  snapshot(): string;
  onData(listener: (output: string) => void): () => void;
  onExit(listener: (exitCode: number) => void): () => void;
}

export interface PtyHost {
  readonly claudePath: string;
  launch(sessionId: string, launch: PtyLaunch): Promise<TerminalPty>;
  get(sessionId: string): TerminalPty | undefined;
}

export interface PtyHostOptions {
  /** Resolved once at startup (plan §6.3); every spawn must run exactly this file. */
  readonly claudePath: string;
  readonly spawn?: typeof nodePty.spawn;
  readonly maxSessions?: number;
}

export function createPtyHost(options: PtyHostOptions): PtyHost {
  if (!isAbsolute(options.claudePath)) throw new Error("The claude path must be absolute.");
  const maxSessions = options.maxSessions ?? MAX_TERMINAL_SESSIONS;
  const livePtys = new Map<string, TerminalPty>();

  const assertLaunchable = (sessionId: string, launch: PtyLaunch) => {
    if (launch.argv[0] !== options.claudePath) throw new TerminalLaunchError("wrong_binary", "Terminal mode only runs the resolved claude binary.");
    const credentialVariable = findCredentialVariable(launch.env);
    if (credentialVariable !== undefined) {
      throw new TerminalLaunchError("credential_env", `Terminal mode never passes a credential; ${credentialVariable} must not be set.`);
    }
    if (livePtys.has(sessionId)) throw new TerminalLaunchError("duplicate_session", "This session already has a terminal.");
    if (livePtys.size >= maxSessions) throw new TerminalLaunchError("session_cap", `At most ${maxSessions} terminals can run at once.`);
  };

  return {
    claudePath: options.claudePath,
    async launch(sessionId, launch) {
      const spawn = options.spawn ?? (await loadNodePty()).spawn;
      // Checked after the await, so two concurrent launches cannot both pass the session cap.
      assertLaunchable(sessionId, launch);
      const [file, ...args] = launch.argv as [string, ...string[]];
      const childPty = spawn(file, args, {
        name: "xterm-256color",
        cols: launch.columns ?? DEFAULT_COLUMNS,
        rows: launch.rows ?? DEFAULT_ROWS,
        cwd: launch.cwd,
        env: { ...launch.env },
      });
      const terminalPty = wrapPty(sessionId, childPty);
      livePtys.set(sessionId, terminalPty);
      terminalPty.onExit(() => livePtys.delete(sessionId));
      return terminalPty;
    },
    get: (sessionId) => livePtys.get(sessionId),
  };
}

function wrapPty(sessionId: string, childPty: nodePty.IPty): TerminalPty {
  const outputRing = createOutputRing(OUTPUT_RING_BYTES);
  childPty.onData((output) => outputRing.append(output));
  let hasExited = false;
  childPty.onExit(() => (hasExited = true));

  return {
    sessionId,
    write: (input) => childPty.write(input),
    resize: (columns, rows) => childPty.resize(columns, rows),
    interrupt: () => childPty.write(INTERRUPT_KEY),
    kill() {
      if (!hasExited) childPty.kill();
    },
    snapshot: () => outputRing.snapshot(),
    onData(listener) {
      const subscription = childPty.onData(listener);
      return () => subscription.dispose();
    },
    onExit(listener) {
      const subscription = childPty.onExit(({ exitCode }) => listener(exitCode));
      return () => subscription.dispose();
    },
  };
}
