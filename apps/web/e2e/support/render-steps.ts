// Created by The Angelo Umali.
// Steps the render e2e specs share: one edit through both approval gates, and the files it leaves in the project.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, FIXTURE_CLIP, type StudioServer } from "./studio-fixture.ts";

// Ingest, transcribe, a 4K master (1080 off NVIDIA) and its QC re-transcription of a 2 s clip; the agent waits on each job.
export const RENDER_TIMEOUT_MS = 5 * 60_000;
const GATED_TOOLS = ["render_master", "export_deliverable"];
const QcReportSchema = z.object({ ok: z.boolean(), checks: z.array(z.object({ name: z.string(), ok: z.boolean() })) });

/** Drops the clip, starts the edit and approves the render and the export; returns the project id. */
export async function editAndApprove(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByTestId("drop-zone").locator('input[type="file"]').setInputFiles(FIXTURE_CLIP);
  await expect(page.getByText("1 file added to the project.")).toBeVisible();
  await page.getByRole("link", { name: /^Open / }).click();

  await page.getByLabel("Prompt").fill("Trim the tail of this clip, render the 4K master, QC it and deliver it with covers.");
  await page.getByRole("button", { name: "Start editing" }).click();

  for (const gatedTool of GATED_TOOLS) {
    const approvalCard = page.getByRole("article").filter({ hasText: "Needs your OK" }).filter({ hasText: gatedTool });
    await approvalCard.getByRole("button", { name: "Approve" }).click({ timeout: RENDER_TIMEOUT_MS });
  }
  return new URL(page.url()).pathname.split("/")[2] ?? "";
}

export async function deliverablesDir(studio: StudioServer, projectId: string): Promise<string> {
  return join(studio.studioHome, "projects", await studio.projectSlug(projectId), "deliverables");
}

/** The engine's QC report, the file export is gated on. */
export async function readQcReport(studio: StudioServer, projectId: string) {
  const qcPath = join(studio.studioHome, "projects", await studio.projectSlug(projectId), "work", "qc", "v1.json");
  return QcReportSchema.parse(JSON.parse(await readFile(qcPath, "utf8")));
}

export async function deliveredFileNames(studio: StudioServer, projectId: string): Promise<string[]> {
  return readdir(await deliverablesDir(studio, projectId)).catch(() => []);
}
