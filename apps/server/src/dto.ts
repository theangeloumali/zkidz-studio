// Created by The Angelo Umali.
// Rows → the shared DTOs; the only place timestamps become ISO strings and storage paths are dropped.
import type { jobs, mediaAssets, projects } from "@zks/db/schema";
import type { Job, MediaAsset, Project } from "@zks/shared";

export type ProjectRow = typeof projects.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;

export function toProjectDto(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    videoId: row.videoId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMediaAssetDto(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    name: row.name,
    bytes: row.bytes,
    isInPlace: row.inPlacePath !== null,
    durationS: row.durationS,
    width: row.width,
    height: row.height,
    fps: row.fpsNum !== null && row.fpsDen !== null ? { num: row.fpsNum, den: row.fpsDen } : null,
    isHdr: row.isHdr,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toJobDto(row: JobRow): Job {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    videoId: row.videoId,
    lane: row.lane,
    status: row.status,
    stage: row.stage,
    pct: row.pct,
    etaS: row.etaS,
    error: row.error,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
