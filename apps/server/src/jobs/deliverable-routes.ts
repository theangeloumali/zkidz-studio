// Created by The Angelo Umali.
// The deliverables list, and the reveal that opens their folder in the host's file manager.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StudioDatabase } from "@zks/db";
import { deliverables } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { projectDir } from "../config.ts";
import { assertLoopbackPeer } from "../http/loopback-peer.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import { toDeliverableDto } from "./deliverables.ts";

const OWNER_ONLY_DIR_MODE = 0o700;

export type FolderOpener = (folderPath: string) => void;

export interface DeliverableRouteDeps {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly openFolder?: FolderOpener;
}

export function registerDeliverableRoutes(app: Hono, deps: DeliverableRouteDeps): void {
  const openFolder = deps.openFolder ?? openInFileManager;

  app.get(API_ROUTES.listDeliverables.path, async (c) => {
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    const rows = await deps.database.select().from(deliverables).where(eq(deliverables.projectId, project.id)).orderBy(desc(deliverables.createdAt));
    return c.json({ deliverables: rows.map(toDeliverableDto) });
  });

  // The folder comes from the project row only; the request body is never read, so a client cannot name a path.
  app.post(API_ROUTES.revealDeliverables.path, async (c) => {
    assertLoopbackPeer(c);
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    const deliverablesDir = join(projectDir(deps.studioHome, project.slug), "deliverables");
    await mkdir(deliverablesDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
    openFolder(deliverablesDir);
    return c.json({ ok: true });
  });
}

function openInFileManager(folderPath: string): void {
  const opener = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(opener, [folderPath], { detached: true, stdio: "ignore", shell: false });
  child.on("error", () => undefined); // No file manager installed is not a server error.
  child.unref();
}
