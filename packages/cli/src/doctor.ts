// Created by The Angelo Umali.
import { redactReport, redactText, type PathRoots } from "@zks/shared";
import type { ZksContext } from "./context.ts";
import {
  checkBootstrapTool,
  checkChromeRender,
  checkClaude,
  checkDisk,
  checkFfmpeg,
  checkModels,
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

export async function runDoctor(context: ZksContext): Promise<CheckResult[]> {
  const checks: (CheckResult | undefined)[] = [
    checkNode(),
    checkBootstrapTool(context, "pnpm"),
    checkBootstrapTool(context, "uv"),
    checkPython(context),
    ...(await checkFfmpeg(context)),
    checkWhisper(context),
    checkChromeRender(context),
    checkModels(context),
    checkClaude(),
    checkDisk(context),
    await checkPort(),
    checkWslMount(context),
  ];
  return checks.filter((check): check is CheckResult => check !== undefined);
}

export function doctorExitCode(checks: CheckResult[]): 0 | 1 {
  return checks.some((check) => check.required && check.status === "fail") ? 1 : 0;
}

const DEFAULT_ROOTS: PathRoots = { homeDir: os.homedir() };

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
