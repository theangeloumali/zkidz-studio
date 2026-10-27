// Created by The Angelo Umali.
// Media intake (plan §9.4): streamed uploads become <assetId>.<ext>; in-place files are registered by realpath, never copied.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { mediaAssets, projects } from "@zks/db/schema";
import { API_ROUTES, PROJECT_TITLE_HEADER, ProjectTitleSchema, type MediaAsset, type Project } from "@zks/shared";
import { asc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { projectDir } from "../config.ts";
import { toMediaAssetDto, toProjectDto, type ProjectRow } from "../dto.ts";
import { HttpError, parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import { assertLoopbackPeer } from "../http/loopback-peer.ts";
import { INCOMING_DIR, UploadTooLargeError } from "../media-io/store.ts";
import { createProject, findProjectOrThrow } from "../projects/project-store.ts";
import { inspectInPlaceFile, insertInPlaceAsset } from "./media-in-place.ts";
import {
  commitStagedUpload,
  insertStagedAsset,
  placeStagedFile,
  PROJECT_CAP_MESSAGE,
  readUploadRequest,
  storedProjectBytes,
  withStagedUpload,
  type MediaRouteDeps,
} from "./media-ingest.ts";

export function registerMediaRoutes(app: Hono, deps: MediaRouteDeps): void {
  /** Declared bytes of uploads still streaming, per project: the DB only counts finished ones. */
  const inFlightBytes = new Map<string, number>();

  app.get(API_ROUTES.listMedia.path, async (c) => {
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    const rows = await deps.database.select().from(mediaAssets).where(eq(mediaAssets.projectId, project.id)).orderBy(asc(mediaAssets.createdAt));
    return c.json({ assets: rows.map(toMediaAssetDto) });
  });

  app.post(API_ROUTES.uploadMedia.path, async (c) => {
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    const upload = readUploadRequest(c, deps.uploadLimits);
    const storedBytes = await storedProjectBytes(deps.database, project.id);
    // Read and reserve with no await in between, so a parallel upload always sees this reservation.
    const remainingProjectBytes = deps.uploadLimits.maxProjectBytes - storedBytes - (inFlightBytes.get(project.id) ?? 0);
    if (upload.declaredBytes > remainingProjectBytes) throw new UploadTooLargeError(PROJECT_CAP_MESSAGE);
    inFlightBytes.set(project.id, (inFlightBytes.get(project.id) ?? 0) + upload.declaredBytes);
    try {
      const rawDir = join(projectDir(deps.studioHome, project.slug), "media", "raw");
      const maxBytes = Math.min(deps.uploadLimits.maxFileBytes, remainingProjectBytes);
      const asset = await withStagedUpload(deps, rawDir, { ...upload, maxBytes }, (staged) => commitStagedUpload(deps, project, staged));
      return c.json(asset, 201);
    } finally {
      const stillInFlight = (inFlightBytes.get(project.id) ?? 0) - upload.declaredBytes;
      if (stillInFlight > 0) inFlightBytes.set(project.id, stillInFlight);
      else inFlightBytes.delete(project.id);
    }
  });

  /** The project is created only after its clip is written and probed, and with its asset in one transaction. */
  app.post(API_ROUTES.createProjectWithMedia.path, async (c) => {
    const title = readProjectTitle(c.req.header(PROJECT_TITLE_HEADER));
    const upload = readUploadRequest(c, deps.uploadLimits);
    if (upload.declaredBytes > deps.uploadLimits.maxProjectBytes) throw new UploadTooLargeError(PROJECT_CAP_MESSAGE);
    const maxBytes = Math.min(deps.uploadLimits.maxFileBytes, deps.uploadLimits.maxProjectBytes);
    const created = await withStagedUpload(deps, join(deps.studioHome, INCOMING_DIR), { ...upload, maxBytes }, async (staged) => {
      const committed = await createProjectWithAsset(deps, title, (transaction, project) => insertStagedAsset(transaction, deps, project.id, staged));
      try {
        await placeStagedFile(deps, committed.project.slug, staged);
      } catch (error) {
        // createProject made this folder, so removing it can only take this request's own files.
        await deps.database.delete(projects).where(eq(projects.id, committed.project.id));
        await rm(projectDir(deps.studioHome, committed.project.slug), { recursive: true, force: true });
        throw error;
      }
      return committed;
    });
    return c.json(created, 201);
  });

  /** The file's checks and probe run before the project exists, so a rejected file creates nothing. */
  app.post(API_ROUTES.createProjectInPlace.path, async (c) => {
    assertLoopbackPeer(c);
    const { path, title } = parseOrBadRequest(API_ROUTES.createProjectInPlace.body, await readJsonBody(c));
    const file = await inspectInPlaceFile(deps, path);
    const created = await createProjectWithAsset(deps, title, (transaction, project) => insertInPlaceAsset(transaction, project.id, file));
    return c.json(created, 201);
  });
}

/** The project and its first asset commit in one transaction. */
async function createProjectWithAsset(
  deps: MediaRouteDeps,
  title: string,
  addAsset: (transaction: MediaRouteDeps["database"], project: ProjectRow) => Promise<MediaAsset>,
): Promise<{ project: Project; asset: MediaAsset }> {
  let createdSlug: string | undefined;
  try {
    return await deps.database.transaction(async (transaction) => {
      const project = await createProject(transaction, deps.studioHome, title);
      createdSlug = project.slug;
      return { project: toProjectDto(project), asset: await addAsset(transaction, project) };
    });
  } catch (error) {
    // The rolled-back row took its slug with it, so the folder createProject made is ours alone.
    if (createdSlug !== undefined) await rm(projectDir(deps.studioHome, createdSlug), { recursive: true, force: true });
    throw error;
  }
}

function readProjectTitle(rawHeader: string | undefined): string {
  try {
    return parseOrBadRequest(ProjectTitleSchema, decodeURIComponent(rawHeader ?? ""));
  } catch (error) {
    if (error instanceof URIError) throw new HttpError(400, `${PROJECT_TITLE_HEADER} is not valid percent-encoding`);
    throw error;
  }
}
