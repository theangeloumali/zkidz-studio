// Created by The Angelo Umali.
// Per-session agent files: an owner-only folder under ZKS_RUN, written once each, removed when the session ends.
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IdSchema } from "@zks/shared";

const OWNER_ONLY_DIR_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;

export async function createAgentFilesDir(runDir: string, sessionId: string): Promise<string> {
  const dir = join(runDir, `${IdSchema.parse(sessionId)}.${randomUUID()}`);
  // Startup clears ZKS_RUN, so the first launch after it creates it; the session folder itself must be new.
  await mkdir(runDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
  await mkdir(dir, { mode: OWNER_ONLY_DIR_MODE });
  return dir;
}

/** "wx": a file that already exists is never reused, so nothing planted beforehand can be read as ours. */
export async function writeAgentFile(dir: string, fileName: string, text: string): Promise<string> {
  const path = join(dir, fileName);
  await writeFile(path, text, { mode: OWNER_ONLY_FILE_MODE, flag: "wx" });
  return path;
}

export async function removeAgentFiles(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
