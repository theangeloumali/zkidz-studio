// Created by The Angelo Umali.
// Copies finished deliverables into ZKS_EXPORT_DIR/<project-slug>/ for another app to pick up.
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Logger } from "../logging/logger.ts";

export interface ExportCopyTarget {
  readonly dir: string;
  readonly logger: Logger;
}

/** The temp name starts with a dot, so a folder watcher skips it until the rename lands the whole file. */
export async function copyToExportDir(exportDir: string, projectRoot: string, slug: string, relPaths: readonly string[]): Promise<void> {
  const slugDir = join(exportDir, slug);
  await mkdir(slugDir, { recursive: true });
  for (const relPath of relPaths) {
    const name = basename(relPath);
    const partPath = join(slugDir, `.${name}.${randomUUID()}.part`);
    try {
      await copyFile(join(projectRoot, relPath), partPath);
      await rename(partPath, join(slugDir, name));
    } catch (error) {
      await rm(partPath, { force: true });
      throw error;
    }
  }
}
