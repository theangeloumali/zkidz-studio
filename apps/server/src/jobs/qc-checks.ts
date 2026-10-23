// Created by The Angelo Umali.
// The Render screen's checks: the engine's work/qc/<video>.json, read as pending once a newer master replaces the one it judged.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { QcCheck } from "@zks/shared";
import { z } from "zod";
import { findLatestMaster, renderedVideoId } from "./master-files.ts";

// qc_master's gates, in the engine's order.
const GATE_LABELS: Readonly<Record<string, string>> = {
  format: "Format",
  frames: "Frame count",
  loudness: "Loudness",
  motion: "Moving footage",
  cutWords: "Words at cuts",
  captionContrast: "Caption contrast",
  hookMouth: "Hook clear of the mouth",
  lipSync: "Lip sync",
};
const PASS_DETAIL = "pass";
const STALE_DETAIL = "The master changed after this check ran";

const QcReportSchema = z.object({
  fingerprint: z.object({ name: z.string(), bytes: z.number() }),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() })),
});
// mtimeNs is past 2^53, so JSON.parse would round it; the digits are read from the text.
const MTIME_NS_PATTERN = /"mtimeNs":\s*(\d+)/;

function pendingChecks(detail: string | null, idPrefix: string, labelPrefix: string): QcCheck[] {
  return Object.entries(GATE_LABELS).map(([name, label]) => ({ id: `${idPrefix}${name}`, label: `${labelPrefix}${label}`, status: "pending", detail }));
}

async function readCurrentReport(projectRoot: string, videoId: string): Promise<{ report: z.infer<typeof QcReportSchema> } | { stale: boolean }> {
  const reportText = await readFile(join(projectRoot, "work", "qc", `${videoId}.json`), "utf8").catch(() => undefined);
  if (reportText === undefined) return { stale: false };
  let parsed;
  try {
    parsed = QcReportSchema.safeParse(JSON.parse(reportText));
  } catch {
    return { stale: false };
  }
  const mtimeNs = MTIME_NS_PATTERN.exec(reportText)?.[1];
  const master = await findLatestMaster(projectRoot, videoId);
  if (!parsed.success || mtimeNs === undefined || master === undefined) return { stale: false };
  const masterStats = await stat(join(projectRoot, master.relPath), { bigint: true });
  const { fingerprint } = parsed.data;
  const isCurrent =
    fingerprint.name === master.relPath.split("/").at(-1) && BigInt(fingerprint.bytes) === masterStats.size && BigInt(mtimeNs) === masterStats.mtimeNs;
  return isCurrent ? { report: parsed.data } : { stale: true };
}

async function checksFor(projectRoot: string, videoId: string, idPrefix: string, labelPrefix: string): Promise<QcCheck[]> {
  const result = await readCurrentReport(projectRoot, videoId);
  if (!("report" in result)) return pendingChecks(result.stale ? STALE_DETAIL : null, idPrefix, labelPrefix);
  return result.report.checks.map(({ name, ok, detail }) => ({
    id: `${idPrefix}${name}`,
    label: `${labelPrefix}${GATE_LABELS[name] ?? name}`,
    status: ok ? "pass" : "fail",
    detail: detail === PASS_DETAIL ? null : detail,
  }));
}

/** The full edit's gates, then the Reels cut's once a Reels master exists. */
export async function listQcChecks(projectRoot: string, videoId: string): Promise<QcCheck[]> {
  const reelVideoId = renderedVideoId(videoId, "reel");
  const fullChecks = await checksFor(projectRoot, videoId, "", "");
  if ((await findLatestMaster(projectRoot, reelVideoId)) === undefined) return fullChecks;
  return [...fullChecks, ...(await checksFor(projectRoot, reelVideoId, "reel:", "Reels: "))];
}
