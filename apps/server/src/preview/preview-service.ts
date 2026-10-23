// Created by The Angelo Umali.
// The live preview loop (plan §9.3): the player's EDL, and an EDL write plus composition rebuild after every spec.version on
// a video the player has open, announced by preview.ready with the composition's URL on the preview origin.
import type { StudioDatabase } from "@zks/db";
import { API_ROUTES, CutSpecSchema, keptSpansOf, LOOPBACK_HOST, VideoIdSchema, type CutSpec, type PlayerEdl } from "@zks/shared";
import type { Hono } from "hono";
import { projectDir } from "../config.ts";
import type { EventBus } from "../events/event-bus.ts";
import { HttpError, notFound } from "../http/http-error.ts";
import type { Logger } from "../logging/logger.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import { readSpecVersion } from "../specs/spec-versions.ts";
import { writePreviewEdl } from "./preview-edl.ts";
import { COMPOSITION_PATH_PREFIX } from "./preview-origin.ts";

export interface PreviewBuildRequest {
  readonly projectRoot: string;
  readonly videoId: string;
}

/** Builds work/preview/<videoId>/ for one video; rejects when the build fails. */
export type BuildComposition = (request: PreviewBuildRequest) => Promise<void>;

export interface PreviewServiceDependencies {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly eventBus: EventBus;
  readonly logger: Logger;
  readonly previewPort: number;
  readonly buildComposition: BuildComposition;
}

export interface PreviewService {
  readonly registerRoutes: (app: Hono) => void;
}

interface BuildState {
  isRerunQueued: boolean;
}

export function createPreviewService(deps: PreviewServiceDependencies): PreviewService {
  const openVideoKeys = new Set<string>();
  const watchedProjectIds = new Set<string>();
  const buildStates = new Map<string, BuildState>();
  let buildCount = 0;

  const watchProject = (projectId: string) => {
    if (watchedProjectIds.has(projectId)) return;
    watchedProjectIds.add(projectId);
    deps.eventBus.subscribe([projectId], (event) => {
      if (event.type === "spec.version" && openVideoKeys.has(videoKeyOf(projectId, event.videoId))) requestBuild(projectId, event.videoId);
    });
  };

  // One build per video at a time; changes landing mid-build fold into a single rebuild after it.
  const requestBuild = (projectId: string, videoId: string) => {
    const videoKey = videoKeyOf(projectId, videoId);
    const runningBuild = buildStates.get(videoKey);
    if (runningBuild !== undefined) {
      runningBuild.isRerunQueued = true;
      return;
    }
    const buildState: BuildState = { isRerunQueued: false };
    buildStates.set(videoKey, buildState);
    void (async () => {
      do {
        buildState.isRerunQueued = false;
        await buildAndAnnounce(projectId, videoId);
      } while (buildState.isRerunQueued);
      buildStates.delete(videoKey);
    })();
  };

  const buildAndAnnounce = async (projectId: string, videoId: string) => {
    try {
      const project = await findProjectOrThrow(deps.database, projectId);
      const projectRoot = projectDir(deps.studioHome, project.slug);
      const cuts = await readCutSpec(deps.database, projectId, videoId);
      await writePreviewEdl(projectRoot, videoId, cuts.spec);
      await deps.buildComposition({ projectRoot, videoId });
      buildCount += 1;
      const compositionUrl = `http://${LOOPBACK_HOST}:${deps.previewPort}${COMPOSITION_PATH_PREFIX}/${projectId}/${videoId}/index.html?build=${buildCount}`;
      await deps.eventBus.publish({ type: "preview.ready", projectId, videoId, edlVersion: cuts.version, compositionUrl });
    } catch (error) {
      deps.logger.error("preview build failed", { projectId, videoId, error });
    }
  };

  const registerRoutes = (app: Hono) => {
    app.get(API_ROUTES.getPlayerEdl.path, async (c) => {
      const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
      const videoId = VideoIdSchema.safeParse(c.req.param("videoId"));
      if (!videoId.success) throw notFound();
      const playerEdl = await readPlayerEdl(deps.database, project.id, videoId.data);

      const videoKey = videoKeyOf(project.id, videoId.data);
      watchProject(project.id);
      if (!openVideoKeys.has(videoKey)) {
        openVideoKeys.add(videoKey);
        requestBuild(project.id, videoId.data);
      }
      return c.json(playerEdl);
    });
  };

  return { registerRoutes };
}

async function readCutSpec(database: StudioDatabase, projectId: string, videoId: string): Promise<{ version: number; spec: CutSpec }> {
  const cutsVersion = await readSpecVersion(database, projectId, { videoId, kind: "cuts" });
  const cuts = CutSpecSchema.safeParse(cutsVersion.content);
  if (!cuts.success) throw new HttpError(422, "The cut spec is not valid");
  return { version: cutsVersion.version, spec: cuts.data };
}

async function readPlayerEdl(database: StudioDatabase, projectId: string, videoId: string): Promise<PlayerEdl> {
  const cuts = await readCutSpec(database, projectId, videoId);
  let editedAtS = 0;
  const segments = keptSpansOf(cuts.spec).map((keptSpan) => {
    const segment = { sourceAtS: keptSpan.at, sourceEndS: keptSpan.end, editedAtS };
    editedAtS += keptSpan.end - keptSpan.at;
    return segment;
  });
  return { videoId, cutsVersion: cuts.version, durationS: cuts.spec.durationS, keptS: editedAtS, segments };
}

const videoKeyOf = (projectId: string, videoId: string) => `${projectId}/${videoId}`;
