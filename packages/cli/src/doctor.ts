// Created by The Angelo Umali.
import { ENV, redactReport, redactText, type PathRoots } from "@zks/shared";
import { checkDatabase } from "@zks/shared/node";
import { writeCapabilities } from "./capabilities.ts";
import type { ZksContext } from "./context.ts";
import {
  checkBootstrapTool,
  checkChromeRender,
  checkClaude,
  checkDisk,
  checkFfmpeg,
  checkModels,
  checkNodePty,
  checkNode,
  checkPort,
  checkPython,
  checkWhisper,
  checkWslMount,
  type CheckResult,
} from "./checks.ts";
import os from "node:os";

export type { CheckResult } from "./checks.ts";

const STATUS_MARK = { ok: "ok  ", warn: "WARN", fail: "FAIL" } as const;

/** `render` adds the slow checks: a test encode per listed encoder, not just the first that works. */
export async function runDoctor(context: ZksContext, { render = false } = {}): Promise<CheckResult[]> {
  const [ffmpegCheck, ...encoderChecks] = await checkFfmpeg(context, { everyEncoder: render });
  const ffmpegPath = ffmpegCheck?.data?.path;
  const checks: (CheckResult | undefined)[] = [
    checkNode(),
    checkBootstrapTool(context, "pnpm"),
    checkBootstrapTool(context, "uv"),
    checkPython(context),
    ffmpegCheck,
    typeof ffmpegPath === "string" ? writeCapabilities(context, ffmpegPath) : undefined,
    ...encoderChecks,
    checkWhisper(context),
    checkChromeRender(context),
    checkModels(context),
    checkClaude(),
    checkNodePty(),
    checkDisk(context),
    // Each can wait out a probe timeout on an interface that never answers, so they wait together.
    ...(await Promise.all([checkPort(), checkDatabase({ databaseUrl: process.env[ENV.databaseUrl] })])),
    checkWslMount(context),
  ];
  return checks.filter((check): check is CheckResult => check !== undefined);
}

export function doctorExitCode(checks: CheckResult[]): 0 | 1 {
  return checks.some((check) => check.required && check.status === "fail") ? 1 : 0;
}

/** What a public report must not name: paths, this machine and its user. */
export function reportRoots(zksHome?: string): PathRoots {
  // userInfo() throws for a uid with no passwd entry, as in some containers.
  let userName: string | undefined;
  try {
    userName = os.userInfo().username;
  } catch {
    userName = undefined;
  }
  return { ...(zksHome ? { zksHome } : {}), homeDir: os.homedir(), hostName: os.hostname(), userName };
}

const DEFAULT_ROOTS: PathRoots = reportRoots();

export function formatDoctorJson(checks: CheckResult[], roots: PathRoots = DEFAULT_ROOTS): string {
  return JSON.stringify(redactReport({ ok: doctorExitCode(checks) === 0, checks }, roots), null, 2);
}

export function formatDoctorText(checks: CheckResult[], roots: PathRoots = DEFAULT_ROOTS): string {
  const lines = checks.flatMap((check) => [
    `${STATUS_MARK[check.status]} ${check.id.padEnd(12)} ${check.detail}`,
    ...(check.fix ? [`     fix: ${check.fix}`] : []),
  ]);
  return redactText(lines.join("\n"), roots);
}

/** A crash under --json still prints JSON, and its message can quote ZKS_HOME paths, so it is redacted too. */
export function formatFatalError(error: unknown, { asJson, roots }: { asJson: boolean; roots: PathRoots }): string {
  const message = redactText(error instanceof Error ? error.message : String(error), roots);
  return asJson ? JSON.stringify({ ok: false, error: message }, null, 2) : message;
}
