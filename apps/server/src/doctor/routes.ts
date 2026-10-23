// Created by The Angelo Umali.
// GET /api/doctor: the CLI's checks (already redacted by `doctor --json`) in the web's shape, cached until ?refresh=1.
import { API_ROUTES, type DoctorCheckSchema } from "@zks/shared";
import type { Hono } from "hono";
import { z } from "zod";
import { HttpError, parseOrBadRequest } from "../http/http-error.ts";
import type { Logger } from "../logging/logger.ts";
import type { DoctorRunner } from "./runner.ts";

type DoctorCheck = z.infer<typeof DoctorCheckSchema>;

export interface DoctorRouteDeps {
  readonly runDoctor: DoctorRunner;
  readonly logger: Logger;
}

// Unknown keys (required, data) are stripped: the web contract is strict.
const CliReportSchema = z.object({
  checks: z.array(z.object({ id: z.string().min(1), status: z.enum(["ok", "warn", "fail"]), detail: z.string(), fix: z.string().optional() })),
});
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
};
// The CLI probes the server's own port, which this server holds, so the row would always fail.
const SERVER_HELD_CHECKS = new Set(["port"]);

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

async function runChecks(deps: DoctorRouteDeps): Promise<DoctorCheck[]> {
  try {
    const report = CliReportSchema.parse(await deps.runDoctor());
    return report.checks
      .filter((check) => !SERVER_HELD_CHECKS.has(check.id))
      .map(({ id, status, detail, fix }) => ({
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
