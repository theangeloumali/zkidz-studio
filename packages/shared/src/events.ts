// Created by The Angelo Umali.
// The UI never sees raw SDK messages; the server maps them (and mode T hooks) to these events (plan §6.11).
import { z } from "zod";
import { RULE_TEXT_MAX_CHARS } from "./api/dto.ts";
import { JobStatusSchema, SpecAuthorSchema, SpecKindSchema, UsageSourceSchema } from "./enums.ts";
import { IdSchema, IsoTimestampSchema, JobPercentSchema, VideoIdSchema, sourceSpan } from "./primitives.ts";

/** `id` is the persisted events row id and doubles as the SSE cursor; bus-only events carry none. */
const eventBaseShape = { id: z.int().positive().optional(), projectId: IdSchema, at: IsoTimestampSchema };

function studioEvent<Type extends string, Fields extends z.ZodRawShape>(type: Type, fields: Fields) {
  return z.strictObject({ type: z.literal(type), ...eventBaseShape, ...fields });
}

export const CUT_CANDIDATE_KINDS = ["stutter", "retake", "false_start", "filler", "pause"] as const;
export const CutCandidateSchema = sourceSpan({ id: z.string().min(1), kind: z.enum(CUT_CANDIDATE_KINDS), context: z.string(), reason: z.string().min(1) });

/** Plan §6.14 failure states. */
export const SESSION_ERROR_KINDS = [
  "claude_missing",
  "sdk_binary_missing",
  "auth_failed",
  "billing_error",
  "rate_limited",
  "model_not_found",
  "max_turns",
  "max_budget",
  "credential_mismatch",
  "terminal_exited",
  "unknown",
] as const;

/** Server-derived, shown above any agent text so a prompt-injected note cannot misdescribe the action. */
export const ApprovalFactsSchema = z.strictObject({
  action: z.string().min(1),
  target: z.string().optional(),
  quality: z.string().optional(),
  estimatedGpuMinutes: z.number().nonnegative().optional(),
  outputPaths: z.array(z.string()),
  filesToDelete: z.array(z.string()),
});

/** An approval card as the server builds it; the broker adds the requestId. */
export const ApprovalCardSchema = z.strictObject({ tool: z.string().min(1), facts: ApprovalFactsSchema, agentNote: z.string().optional() });

/** The AskUserQuestion tool's question shape. */
export const AskedQuestionSchema = z.strictObject({
  question: z.string().min(1),
  header: z.string().optional(),
  options: z.array(z.strictObject({ label: z.string().min(1), description: z.string().optional() })),
  multiSelect: z.boolean().optional(),
});

/** Session totals as the agent reports them; the edit recorder keeps the latest per session, never a running sum. */
export const UsageFiguresSchema = z.strictObject({
  costUsd: z.number().nonnegative().optional(),
  inputTokens: z.int().nonnegative().optional(),
  outputTokens: z.int().nonnegative().optional(),
  cacheTokens: z.int().nonnegative().optional(),
  durationMs: z.int().nonnegative().optional(),
});

/** At most this many lessons per card, each short enough to become a rule as written. */
export const MAX_SUGGESTED_LESSONS = 5;
export const LessonTextSchema = z.string().trim().min(1).max(RULE_TEXT_MAX_CHARS);

/**
 * AskUserQuestion's input as Claude Code sends it: loose, because it adds fields over time (an option's `preview`),
 * and a strict parse would refuse the whole question. toAskedQuestions keeps what a card shows.
 */
export const AskUserQuestionInputSchema = z.looseObject({
  questions: z
    .array(
      z.looseObject({
        question: z.string().min(1),
        header: z.string().optional(),
        options: z.array(z.looseObject({ label: z.string().min(1), description: z.string().optional() })),
        multiSelect: z.boolean().optional(),
      }),
    )
    .min(1),
});

export function toAskedQuestions(input: z.infer<typeof AskUserQuestionInputSchema>): z.infer<typeof AskedQuestionSchema>[] {
  return input.questions.map(({ question, header, options, multiSelect }) => ({
    question,
    ...(header === undefined ? {} : { header }),
    options: options.map(({ label, description }) => ({ label, ...(description === undefined ? {} : { description }) })),
    ...(multiSelect === undefined ? {} : { multiSelect }),
  }));
}

function jobLifecycleEvent<Type extends string>(type: Type) {
  return studioEvent(type, { jobId: IdSchema, kind: z.string().min(1), status: JobStatusSchema });
}

const studioEventSchemas = [
  studioEvent("session.started", { sessionId: z.string().min(1), model: z.string(), credential: z.string(), skills: z.array(z.string()) }),
  studioEvent("text.delta", { text: z.string() }),
  studioEvent("tool.started", { toolUseId: z.string().min(1), name: z.string().min(1) }),
  studioEvent("tool.called", { toolUseId: z.string().min(1), name: z.string().min(1), label: z.string(), input: z.unknown() }),
  studioEvent("tool.finished", { toolUseId: z.string().min(1), ok: z.boolean(), summary: z.string(), images: z.array(z.string()).optional() }),
  studioEvent("tool.heartbeat", { toolUseId: z.string().min(1), elapsedS: z.number().nonnegative() }),
  studioEvent("tool.denied", { name: z.string().min(1), reason: z.string().min(1) }),
  studioEvent("question.asked", { requestId: z.string().min(1), questions: z.array(AskedQuestionSchema).min(1) }),
  studioEvent("approval.requested", { requestId: z.string().min(1), ...ApprovalCardSchema.shape }),
  studioEvent("spec.version", {
    videoId: VideoIdSchema,
    kind: SpecKindSchema,
    version: z.int().positive(),
    author: SpecAuthorSchema,
    note: z.string().optional(),
  }),
  studioEvent("preview.ready", { videoId: VideoIdSchema, edlVersion: z.int().positive(), compositionUrl: z.url() }),
  jobLifecycleEvent("job.queued"),
  jobLifecycleEvent("job.started"),
  jobLifecycleEvent("job.finished"),
  studioEvent("job.progress", { jobId: IdSchema, stage: z.string().min(1), pct: JobPercentSchema, etaS: z.number().nonnegative().optional() }),
  studioEvent("retry", { attempt: z.int().positive(), max: z.int().positive(), delayMs: z.int().nonnegative(), reason: z.string() }),
  studioEvent("limit", {
    status: z.enum(["allowed", "allowed_warning", "rejected"]),
    resetsAt: IsoTimestampSchema.optional(),
    utilization: z.number().min(0).optional(),
  }),
  studioEvent("turn.completed", {
    subtype: z.string().min(1),
    isError: z.boolean(),
    costUsd: z.number().nonnegative().optional(),
    numTurns: z.int().nonnegative(),
    durationMs: z.int().nonnegative(),
  }),
  studioEvent("context.compacted", {}),
  studioEvent("cuts.proposed", { requestId: z.string().min(1), candidates: z.array(CutCandidateSchema) }),
  studioEvent("prompt.submitted", { text: z.string() }),
  studioEvent("narration", { text: z.string() }),
  studioEvent("terminal.state", { state: z.enum(["starting", "ready", "working", "waiting", "exited"]), exitCode: z.int().optional() }),
  studioEvent("session.error", { kind: z.enum(SESSION_ERROR_KINDS), message: z.string().min(1), action: z.string().optional() }),
  studioEvent("usage.reported", { sessionId: z.string().min(1), source: UsageSourceSchema, ...UsageFiguresSchema.shape }),
  studioEvent("lessons.suggested", { requestId: z.string().min(1), lessons: z.array(LessonTextSchema).min(1).max(MAX_SUGGESTED_LESSONS) }),
  studioEvent("edit.closed", { editId: IdSchema, ...UsageFiguresSchema.shape }),
  studioEvent("resync", {}),
] as const;

export const StudioEventSchema = z.discriminatedUnion("type", studioEventSchemas);
export const STUDIO_EVENT_TYPES = studioEventSchemas.map((eventSchema) => eventSchema.shape.type.value);
/** Never persisted, so never replayed after a reconnect. */
/** usage.reported repeats on every status-line refresh; the edits row keeps what matters. */
export const EPHEMERAL_EVENT_TYPES = ["text.delta", "tool.heartbeat", "usage.reported"] as const satisfies readonly StudioEventType[];

export type StudioEvent = z.infer<typeof StudioEventSchema>;
export type StudioEventType = StudioEvent["type"];
export type CutCandidate = z.infer<typeof CutCandidateSchema>;
export type ApprovalFacts = z.infer<typeof ApprovalFactsSchema>;
export type ApprovalCard = z.infer<typeof ApprovalCardSchema>;
export type UsageFigures = z.infer<typeof UsageFiguresSchema>;
