// Created by The Angelo Umali.
// What every studio tool handler runs against; the agent and terminal slices build one per session (plan §6.8).
import type { StudioDatabase } from "@zks/db";
import type { AskedQuestionSchema } from "@zks/shared";
import type { z } from "zod";
import type { ApprovalCard } from "../agent/decisions.ts";
import type { EventBus } from "../events/event-bus.ts";
import type { JobRunner } from "../jobs/job-runner.ts";
import type { EngineRunner } from "./engine-jobs.ts";

export type { ApprovalCard };

type ApprovalDecision = "allow" | "deny";
export type AskedQuestions = readonly z.infer<typeof AskedQuestionSchema>[];
/** Answer label per question text, as AskUserQuestion's updatedInput carries them. */
export type QuestionAnswers = Readonly<Record<string, string>>;

export interface ToolContext {
  readonly projectId: string;
  readonly studioHome: string;
  readonly db: StudioDatabase;
  readonly events: EventBus;
  readonly jobs: JobRunner;
  /** Short engine checks a tool waits on (validate-cue, cue-kinds); long work goes through `jobs`. */
  readonly engine: EngineRunner;
  /** DecisionBroker.requestApproval for this project: it assigns the requestId and cancels the card on abort. */
  readonly requestApproval: (card: ApprovalCard, signal?: AbortSignal) => Promise<ApprovalDecision>;
  /** A question.asked card through the DecisionBroker; null when dismissed or cancelled. Only the -p `approve` tool asks. */
  readonly askQuestions: (questions: AskedQuestions, signal?: AbortSignal) => Promise<QuestionAnswers | null>;
}
