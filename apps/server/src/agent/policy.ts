// Created by The Angelo Umali.
// Deny-by-default canUseTool (plan §6.10). Never bypassPermissions or dontAsk: this is the only allow path.
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { AskedQuestionSchema, findStudioTool, type ApprovalFacts } from "@zks/shared";
import { z } from "zod";
import { assertNever } from "./assert-never.ts";
import type { DecisionBroker } from "./decisions.ts";
import { describeGateCall } from "./gate-facts.ts";
import { bareToolName } from "./tool-names.ts";

/** Read is confined by the PreToolUse hook, which runs before this. */
const ALWAYS_ALLOWED_TOOLS: ReadonlySet<string> = new Set(["Read", "Skill"]);
const AskUserQuestionInputSchema = z.object({ questions: z.array(AskedQuestionSchema).min(1) });

export interface ToolDeciderOptions {
  readonly projectId: string;
  readonly broker: DecisionBroker;
  /** The project-aware facts (output paths, GPU estimate); without it the card shows only what the input says. */
  readonly describeGate?: (tool: string, input: unknown) => Promise<ApprovalFacts | null>;
}

type DeciderCall = ToolDeciderOptions & { readonly toolName: string; readonly input: Record<string, unknown>; readonly signal: AbortSignal };

export function createToolDecider(options: ToolDeciderOptions): CanUseTool {
  return (toolName, input, { signal }) => decide({ ...options, toolName, input, signal });
}

async function decide(call: DeciderCall): Promise<PermissionResult> {
  if (ALWAYS_ALLOWED_TOOLS.has(call.toolName)) return allow(call.input);
  if (call.toolName === "AskUserQuestion") return askQuestions(call);
  const approval = findStudioTool(call.toolName)?.approval;
  switch (approval) {
    case "auto":
    case "review":
      return allow(call.input);
    case "gate":
      return askApproval(call);
    case "permission_prompt":
    case undefined:
      return deny(call, "This tool is not available in the studio");
    default:
      return assertNever(approval);
  }
}

async function askQuestions(call: DeciderCall): Promise<PermissionResult> {
  const parsed = AskUserQuestionInputSchema.safeParse(call.input);
  if (!parsed.success) return deny(call, "The question was malformed");
  const answers = await call.broker.askQuestions(call.projectId, parsed.data.questions, call.signal);
  if (answers === null) return { behavior: "deny", message: "The question was dismissed" };
  return allow({ ...call.input, answers });
}

async function askApproval(call: DeciderCall): Promise<PermissionResult> {
  const tool = bareToolName(call.toolName);
  const describeGate = call.describeGate ?? ((name: string, input: unknown) => Promise.resolve(describeGateCall(name, input)));
  const facts = await describeGate(tool, call.input).catch(() => null);
  if (facts === null) return deny(call, "The tool input was invalid");
  const decision = await call.broker.ask({
    projectId: call.projectId,
    kind: "approval",
    signal: call.signal,
    card: (requestId) => ({ type: "approval.requested", projectId: call.projectId, requestId, tool, facts }),
  });
  if (decision?.kind === "approval" && decision.decision === "allow") return allow(call.input);
  return { behavior: "deny", message: decision?.kind === "approval" ? (decision.message ?? "The user declined") : "The request was cancelled" };
}

function allow(input: Record<string, unknown>): PermissionResult {
  return { behavior: "allow", updatedInput: input };
}

async function deny(call: DeciderCall, reason: string): Promise<PermissionResult> {
  await call.broker.publish({ type: "tool.denied", projectId: call.projectId, name: call.toolName, reason });
  return { behavior: "deny", message: reason };
}
