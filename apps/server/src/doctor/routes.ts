// Created by The Angelo Umali.
// GET /api/doctor: the CLI's checks (redacted by `doctor --json`) plus the server's own database check, in the web's shape,
// cached until ?refresh=1. The database row stays unredacted: it names no secret, and this page is only served on loopback.
import { API_ROUTES, type DoctorCheckSchema } from "@zks/shared";
import type { DatabaseCheck } from "@zks/shared/node";
import type { Hono } from "hono";
import { z } from "zod";
import { HttpError, parseOrBadRequest } from "../http/http-error.ts";
import type { Logger } from "../logging/logger.ts";
import type { DoctorRunner } from "./runner.ts";

type DoctorCheck = z.infer<typeof DoctorCheckSchema>;

export interface DoctorRouteDeps {
  readonly runDoctor: DoctorRunner;
  /** Run here, against the server's own DATABASE_URL, which the doctor child is never given. */
  readonly checkDatabase: () => Promise<DatabaseCheck>;
  readonly logger: Logger;
}

// Unknown keys (required, data) are stripped: the web contract is strict.
const CliReportSchema = z.object({
  checks: z.array(z.object({ id: z.string().min(1), status: z.enum(["ok", "warn", "fail"]), detail: z.string(), fix: z.string().optional() })),
});
// What the CLI prints when the doctor itself crashed; its message is the only clue, so it goes to the log.
const CliFatalSchema = z.object({ ok: z.literal(false), error: z.string() });
const WEB_STATUS = { ok: "pass", warn: "warn", fail: "fail" } as const;
const LABELS: Readonly<Record<string, string>> = {
  node: "Node.js",
  pnpm: "pnpm",
  uv: "uv",
  python: "Python",
  ffmpeg: "ffmpeg",
  gpu: "GPU encoder",
  "whisper-cpp": "whisper.cpp",
  chrome: "Chrome",
  models: "Transcription models",
  claude: "Claude Code",
  "node-pty": "Terminal support",
  disk: "Disk space",
  wsl: "WSL filesystem",
  database: "Data backend",
};
// The CLI probes the server's own port, which this server holds, so that row would always fail; its database row is
// blind (no DATABASE_URL in the child), so the server's own check replaces it.
const SERVER_HELD_CHECKS = new Set(["port", "database"]);

export function registerDoctorRoutes(app: Hono, deps: DoctorRouteDeps): void {
  let cached: Promise<DoctorCheck[]> | undefined;
  const runFresh = () => {
    const pending = runChecks(deps);
    cached = pending;
    // A failed run is not cached, so the next request tries again.
    void pending.catch(() => {
      if (cached === pending) cached = undefined;
    });
    return pending;
  };

  app.get(API_ROUTES.getDoctor.path, async (c) => {
    const { refresh } = parseOrBadRequest(API_ROUTES.getDoctor.query, c.req.query());
    const checks = await (refresh === undefined && cached !== undefined ? cached : runFresh());
    return c.json({ checks });
  });
}

function parseCliReport(raw: unknown) {
  const fatal = CliFatalSchema.safeParse(raw);
  if (fatal.success) throw new Error(`zks doctor could not run: ${fatal.data.error}`);
  return CliReportSchema.parse(raw);
}

async function runChecks(deps: DoctorRouteDeps): Promise<DoctorCheck[]> {
  try {
    const [report, database] = await Promise.all([deps.runDoctor().then(parseCliReport), deps.checkDatabase()]);
    return [...report.checks.filter((check) => !SERVER_HELD_CHECKS.has(check.id)), database].map(({ id, status, detail, fix }) => ({
      id,
      label: LABELS[id] ?? id,
      status: WEB_STATUS[status],
      detail,
      ...(fix === undefined ? {} : { fix }),
    }));
  } catch (error) {
    deps.logger.error("doctor checks failed", { error });
    throw new HttpError(500, "The system checks could not run; see the server log");
  }
}
