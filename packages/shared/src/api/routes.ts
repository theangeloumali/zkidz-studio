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
  ProjectSchema,
  RULE_TEXT_MAX_CHARS,
  RuleSchema,
  SpecSummarySchema,
  SpecVersionSchema,
} from "./dto.ts";
import { EventsQuerySchema } from "./sse.ts";
import { HookPayloadSchema, HookResponseSchema, TerminalSocketQuerySchema, TerminalTicketSchema } from "./terminal.ts";

export const CSRF_HEADER = "x-zks-csrf";
/** The original filename travels as display text only (plan §9.4). */
export const UPLOAD_FILENAME_HEADER = "x-zks-filename";

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
  z.strictObject({ kind: z.literal("cuts"), requestId: z.string().min(1), approved: z.array(z.string()), rejected: z.array(z.string()) }),
]);

const RuleTextSchema = z.string().trim().min(1).max(RULE_TEXT_MAX_CHARS);

export const API_ROUTES = {
  events: { method: "GET", path: "/api/events", query: EventsQuerySchema, response: "sse" },

  listProjects: { method: "GET", path: "/api/projects", response: z.strictObject({ projects: z.array(ProjectSchema) }) },
  createProject: { method: "POST", path: "/api/projects", body: z.strictObject({ title: z.string().trim().min(1) }), response: ProjectSchema },
  getProject: { method: "GET", path: "/api/projects/:projectId", response: ProjectSchema },
  submitPrompt: { method: "POST", path: "/api/projects/:projectId/prompt", body: z.strictObject({ text: z.string().trim().min(1) }), response: OkSchema },
  decide: { method: "POST", path: "/api/projects/:projectId/decisions", body: DecisionRequestSchema, response: OkSchema },
  stopTurn: { method: "POST", path: "/api/projects/:projectId/stop", body: null, response: OkSchema },
  killSession: { method: "POST", path: "/api/projects/:projectId/kill", body: null, response: OkSchema },

  listMedia: { method: "GET", path: "/api/projects/:projectId/media", response: z.strictObject({ assets: z.array(MediaAssetSchema) }) },
  uploadMedia: { method: "POST", path: "/api/projects/:projectId/media", body: "binary", response: MediaAssetSchema },
  registerInPlace: {
    method: "POST",
    path: "/api/projects/:projectId/media/in-place",
    body: z.strictObject({ path: z.string().min(1) }),
    response: MediaAssetSchema,
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

  listJobs: { method: "GET", path: "/api/projects/:projectId/jobs", response: z.strictObject({ jobs: z.array(JobSchema) }) },
  listDeliverables: { method: "GET", path: "/api/projects/:projectId/deliverables", response: z.strictObject({ deliverables: z.array(DeliverableSchema) }) },
  revealDeliverables: { method: "POST", path: "/api/projects/:projectId/reveal", body: null, response: OkSchema },

  listRules: { method: "GET", path: "/api/rules", response: z.strictObject({ rules: z.array(RuleSchema) }) },
  createRule: { method: "POST", path: "/api/rules", body: z.strictObject({ text: RuleTextSchema, sourceQuote: z.string().optional() }), response: RuleSchema },
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

  getDoctor: { method: "GET", path: "/api/doctor", response: z.strictObject({ checks: z.array(DoctorCheckSchema) }) },
  getSettings: { method: "GET", path: "/api/settings", response: z.record(z.string(), z.unknown()) },
  updateSettings: { method: "PUT", path: "/api/settings", body: z.record(z.string(), z.unknown()), response: z.record(z.string(), z.unknown()) },

  terminalTicket: { method: "POST", path: "/api/terminal/:sessionId/ticket", body: null, response: TerminalTicketSchema },
  terminalSocket: { method: "GET", path: "/api/terminal/:sessionId/ws", query: TerminalSocketQuerySchema, response: "websocket" },
  /** Called by the PTY's Claude Code with `Authorization: Bearer $ZKS_HOOK_TOKEN`, not by the browser. */
  terminalHooks: { method: "POST", path: "/api/terminal/:sessionId/hooks", body: HookPayloadSchema, response: HookResponseSchema },
} as const satisfies Record<string, ApiRoute>;

export type ApiRouteName = keyof typeof API_ROUTES;
