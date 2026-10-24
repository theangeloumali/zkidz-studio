// Created by The Angelo Umali.
// Every REST route the web app and server share. Writes need Origin + CSRF_HEADER + JSON (plan §11).
import { z } from "zod";
import { CloudProviderSchema } from "../enums.ts";
import {
  ConnectionSchema,
  DeliverableSchema,
  DoctorCheckSchema,
  JobSchema,
  MediaAssetSchema,
  PROJECT_TITLE_MAX_CHARS,
  ProjectSchema,
  ProjectSettingsSchema,
  ProjectSettingsUpdateSchema,
  RULE_TEXT_MAX_CHARS,
  RuleSchema,
  SettingsSchema,
  SettingsUpdateSchema,
  PlayerEdlSchema,
  SpecSummarySchema,
  SpecVersionSchema,
  StyleChoiceSchema,
  SpecVersionSummarySchema,
} from "./dto.ts";
import { HomeTemplatesSchema, StartTemplateRequestSchema, StartTemplateResponseSchema, StyleCardsSchema } from "./onboarding.ts";
import { HardwareSchema, QcCheckSchema } from "./render.ts";
import { EventsQuerySchema } from "./sse.ts";
import { HookPayloadSchema, HookResponseSchema, OpenTerminalResponseSchema, TerminalSocketQuerySchema, TerminalTicketSchema } from "./terminal.ts";

export const CSRF_HEADER = "x-zks-csrf";
/** The original filename travels as display text only (plan §9.4). */
export const UPLOAD_FILENAME_HEADER = "x-zks-filename";
/** encodeURIComponent'd title for createProjectWithMedia; the body is the clip, so the title rides in a header. */
export const PROJECT_TITLE_HEADER = "x-zks-project-title";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ApiRoute {
  readonly method: HttpMethod;
  readonly path: `/api/${string}`;
  readonly query?: z.ZodType;
  /** null: no body. "binary": a streamed upload. GET routes omit it. */
  readonly body?: z.ZodType | null | "binary";
  readonly response: z.ZodType | "sse" | "binary" | "websocket";
}

export function isStateChangingMethod(method: string): boolean {
  const upperMethod = method.toUpperCase();
  return upperMethod !== "GET" && upperMethod !== "HEAD";
}

const OkSchema = z.strictObject({ ok: z.literal(true) });

export const DecisionRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("approval"), requestId: z.string().min(1), decision: z.enum(["allow", "deny"]), message: z.string().optional() }),
  z.strictObject({ kind: z.literal("question"), requestId: z.string().min(1), answers: z.record(z.string(), z.string()) }),
]);

/** The user's verdict on propose_cuts candidates (decideCutCandidates); ids not approved count as rejected. */
export const CutReviewDecisionSchema = z.strictObject({ approved: z.array(z.string()), rejected: z.array(z.string()) });

const RuleTextSchema = z.string().trim().min(1).max(RULE_TEXT_MAX_CHARS);
export const ProjectTitleSchema = z.string().trim().min(1).max(PROJECT_TITLE_MAX_CHARS);
const ProjectWithAssetSchema = z.strictObject({ project: ProjectSchema, asset: MediaAssetSchema });

export const API_ROUTES = {
  events: { method: "GET", path: "/api/events", query: EventsQuerySchema, response: "sse" },

  listProjects: { method: "GET", path: "/api/projects", response: z.strictObject({ projects: z.array(ProjectSchema) }) },
  createProject: { method: "POST", path: "/api/projects", body: z.strictObject({ title: ProjectTitleSchema }), response: ProjectSchema },
  getProject: { method: "GET", path: "/api/projects/:projectId", response: ProjectSchema },
  submitPrompt: { method: "POST", path: "/api/projects/:projectId/prompt", body: z.strictObject({ text: z.string().trim().min(1) }), response: OkSchema },
  decide: { method: "POST", path: "/api/projects/:projectId/decisions", body: DecisionRequestSchema, response: OkSchema },
  stopTurn: { method: "POST", path: "/api/projects/:projectId/stop", body: null, response: OkSchema },
  killSession: { method: "POST", path: "/api/projects/:projectId/kill", body: null, response: OkSchema },

  listMedia: { method: "GET", path: "/api/projects/:projectId/media", response: z.strictObject({ assets: z.array(MediaAssetSchema) }) },
  uploadMedia: { method: "POST", path: "/api/projects/:projectId/media", body: "binary", response: MediaAssetSchema },
  /** uploadMedia plus PROJECT_TITLE_HEADER: the project exists only if the clip is accepted. */
  createProjectWithMedia: { method: "POST", path: "/api/projects/media", body: "binary", response: ProjectWithAssetSchema },
  /** A file used where it lies, never copied: the project exists only if the file is accepted. */
  createProjectInPlace: {
    method: "POST",
    path: "/api/projects/in-place",
    body: z.strictObject({ path: z.string().min(1), title: ProjectTitleSchema }),
    response: ProjectWithAssetSchema,
  },
  listFolder: {
    method: "GET",
    path: "/api/fs/list",
    query: z.strictObject({ path: z.string().optional() }),
    response: z.strictObject({
      path: z.string(),
      entries: z.array(z.strictObject({ name: z.string(), isDirectory: z.boolean(), bytes: z.int().nonnegative().optional() })),
    }),
  },
  streamMedia: { method: "GET", path: "/api/media/:assetId", response: "binary" },

  listSpecs: { method: "GET", path: "/api/projects/:projectId/specs", response: z.strictObject({ specs: z.array(SpecSummarySchema) }) },
  getSpecVersion: {
    method: "GET",
    path: "/api/projects/:projectId/specs/:videoId/:kind",
    query: z.strictObject({ version: z.coerce.number().int().positive().optional() }),
    response: SpecVersionSchema,
  },
  restoreSpecVersion: {
    method: "POST",
    path: "/api/projects/:projectId/specs/:videoId/:kind/restore",
    body: z.strictObject({ version: z.int().positive() }),
    response: SpecSummarySchema,
  },
  listSpecVersions: {
    method: "GET",
    path: "/api/projects/:projectId/specs/:videoId/:kind/versions",
    response: z.strictObject({ versions: z.array(SpecVersionSummarySchema) }),
  },
  decideCutCandidates: { method: "POST", path: "/api/projects/:projectId/cut-candidates/:requestId", body: CutReviewDecisionSchema, response: OkSchema },
  getPlayerEdl: { method: "GET", path: "/api/projects/:projectId/videos/:videoId/edl", response: PlayerEdlSchema },

  listJobs: { method: "GET", path: "/api/projects/:projectId/jobs", response: z.strictObject({ jobs: z.array(JobSchema) }) },
  listDeliverables: { method: "GET", path: "/api/projects/:projectId/deliverables", response: z.strictObject({ deliverables: z.array(DeliverableSchema) }) },
  revealDeliverables: { method: "POST", path: "/api/projects/:projectId/reveal", body: null, response: OkSchema },

  listRules: { method: "GET", path: "/api/rules", response: z.strictObject({ rules: z.array(RuleSchema) }) },
  createRule: {
    method: "POST",
    path: "/api/rules",
    body: z.strictObject({ text: RuleTextSchema, sourceQuote: z.string().trim().max(RULE_TEXT_MAX_CHARS).optional() }),
    response: RuleSchema,
  },
  updateRule: { method: "PATCH", path: "/api/rules/:ruleId", body: z.strictObject({ isEnabled: z.boolean() }), response: RuleSchema },
  deleteRule: { method: "DELETE", path: "/api/rules/:ruleId", body: null, response: OkSchema },

  getConnection: { method: "GET", path: "/api/connect", response: ConnectionSchema },
  connectApiKey: { method: "POST", path: "/api/connect/api-key", body: z.strictObject({ apiKey: z.string().trim().min(1) }), response: ConnectionSchema },
  connectCloud: {
    method: "POST",
    path: "/api/connect/cloud",
    body: z.strictObject({ provider: CloudProviderSchema, values: z.record(z.string(), z.string()) }),
    response: ConnectionSchema,
  },
  connectTerminal: {
    method: "POST",
    path: "/api/connect/terminal",
    body: z.strictObject({ hasAcceptedDisclosure: z.literal(true) }),
    response: ConnectionSchema,
  },

  /** The server caches the checks; `?refresh=1` runs them again. */
  getDoctor: {
    method: "GET",
    path: "/api/doctor",
    query: z.strictObject({ refresh: z.literal("1").optional() }),
    response: z.strictObject({ checks: z.array(DoctorCheckSchema) }),
  },
  getSettings: { method: "GET", path: "/api/settings", response: SettingsSchema },
  updateSettings: { method: "PUT", path: "/api/settings", body: SettingsUpdateSchema, response: SettingsSchema },

  openTerminal: { method: "POST", path: "/api/projects/:projectId/terminal", body: null, response: OpenTerminalResponseSchema },
  terminalTicket: { method: "POST", path: "/api/terminal/:sessionId/ticket", body: null, response: TerminalTicketSchema },
  terminalSocket: { method: "GET", path: "/api/terminal/:sessionId/ws", query: TerminalSocketQuerySchema, response: "websocket" },
  /** Called by the PTY's Claude Code with `Authorization: Bearer $ZKS_HOOK_TOKEN`, not by the browser. */
  terminalHooks: { method: "POST", path: "/api/terminal/:sessionId/hooks", body: HookPayloadSchema, response: HookResponseSchema },

  getProjectSettings: { method: "GET", path: "/api/projects/:projectId/settings", response: ProjectSettingsSchema },
  updateProjectSettings: { method: "PUT", path: "/api/projects/:projectId/settings", body: ProjectSettingsUpdateSchema, response: ProjectSettingsSchema },
  /** Phase 6: the house style new edits start from, and the bundled demo project for a first run with no footage. */
  getStyle: { method: "GET", path: "/api/style", response: StyleChoiceSchema },
  setStyle: { method: "PUT", path: "/api/style", body: StyleChoiceSchema, response: StyleChoiceSchema },
  openDemoProject: { method: "POST", path: "/api/projects/demo", body: null, response: ProjectSchema },
  /** The shipped presets, validated server-side so the web never keeps its own copy. */
  listStylePresets: { method: "GET", path: "/api/style/presets", response: StyleCardsSchema },
  listTemplates: { method: "GET", path: "/api/templates", response: HomeTemplatesSchema },
  /** Stores the template's ingest mode on the project and starts the matching ingest job. */
  startTemplate: { method: "POST", path: "/api/projects/:projectId/template", body: StartTemplateRequestSchema, response: StartTemplateResponseSchema },
  /** null until the hardware is probed. */
  getHardware: { method: "GET", path: "/api/hardware", response: HardwareSchema.nullable() },
  listQcChecks: { method: "GET", path: "/api/projects/:projectId/qc", response: z.strictObject({ checks: z.array(QcCheckSchema) }) },
  resumeJob: { method: "POST", path: "/api/projects/:projectId/jobs/:jobId/resume", body: null, response: z.strictObject({ job: JobSchema }) },
} as const satisfies Record<string, ApiRoute>;

export type ApiRouteName = keyof typeof API_ROUTES;
