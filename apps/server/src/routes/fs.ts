// Created by The Angelo Umali.
// GET /api/fs/list: the in-place picker's folder browser (plan §9.4). Loopback peers only; dot entries and ZKS_HOME stay hidden.
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { API_ROUTES } from "@zks/shared";
import type { Hono } from "hono";
import { checkUserPath, isWithinDir } from "../fs/path-policy.ts";
import { HttpError, parseOrBadRequest } from "../http/http-error.ts";
import { assertLoopbackPeer } from "../http/loopback-peer.ts";
import { resolveExistingPath } from "./media.ts";

type FolderEntry = { name: string; isDirectory: boolean; bytes?: number };

/** Windows drives under WSL are slow 9p mounts; the UI shows this so the user can expect slow scrubbing. */
const WSL_MOUNT_WARNING = "This folder is a Windows drive mounted into WSL; reading media from it is slow";

export function registerFsRoutes(app: Hono, deps: { readonly studioHome: string }): void {
  app.get(API_ROUTES.listFolder.path, async (c) => {
    assertLoopbackPeer(c);
    const { path: requestedPath } = parseOrBadRequest(API_ROUTES.listFolder.query, c.req.query());
    const folderPath = await resolveExistingPath(checkUserPath(requestedPath ?? homedir()));
    const studioHome = await realpath(deps.studioHome);
    if (isWithinDir(folderPath, studioHome)) throw new HttpError(400, "The studio folder cannot be browsed");
    if (!(await stat(folderPath)).isDirectory()) throw new HttpError(400, "The path is not a folder");

    const dirents = await readdir(folderPath, { withFileTypes: true });
    const visible = dirents.filter((dirent) => !dirent.name.startsWith(".") && join(folderPath, dirent.name) !== studioHome);
    const entries = await Promise.all(visible.map((dirent) => describeEntry(folderPath, dirent.name)));
    entries.sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory) || left.name.localeCompare(right.name));

    if (process.platform === "linux" && folderPath.startsWith("/mnt/")) c.header("x-zks-warning", WSL_MOUNT_WARNING);
    return c.json({ path: folderPath, entries });
  });
}

/** Follows symlinks so a linked folder browses like a folder; a dangling link lists as a zero-byte file. */
async function describeEntry(folderPath: string, name: string): Promise<FolderEntry> {
  const entryStats = await stat(join(folderPath, name)).catch(() => null);
  if (entryStats?.isDirectory() === true) return { name, isDirectory: true };
  return { name, isDirectory: false, bytes: entryStats?.size ?? 0 };
}
