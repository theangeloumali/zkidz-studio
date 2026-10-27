// Created by The Angelo Umali.
// `approve`, the `claude -p` fallback's --permission-prompt-tool (plan §6.7): the §6.10 deny-by-default policy for a path
// with no canUseTool. Gated studio tools pass here because the twin route raises their card when they run, so one card per call.
import { AskedQuestionSchema, findStudioTool, STUDIO_TOOL_NAMES, STUDIO_TOOLS, studioToolName } from "@zks/shared";
import { z } from "zod";
import type { ToolContext } from "../context.ts";
import type { StudioTool } from "../define-tool.ts";
import { describeFirstIssue, toolErrorResult, toolResult } from "../result.ts";

/** What Claude Code sends (captured from 2.1.309); not strict, so a field added upstream does not fail every prompt. */
const PermissionPromptSchema = z.object({
  tool_name: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  tool_use_id: z.string().optional(),
});
type PermissionPrompt = z.infer<typeof PermissionPromptSchema>;
type PermissionDecision = z.input<typeof STUDIO_TOOLS.approve.output>;

/** Read is confined by the PreToolUse hook in the -p run's --settings, which runs before this prompt. */
const ALWAYS_ALLOWED_TOOLS: ReadonlySet<string> = new Set(["Read", "Skill"]);
const AskUserQuestionInputSchema = z.object({ questions: z.array(AskedQuestionSchema).min(1) });
const STUDIO_TOOL_NAME_SET: ReadonlySet<string> = new Set(STUDIO_TOOL_NAMES);
const NOT_AVAILABLE = "This tool is not available in the studio";

export const approveTool: StudioTool = {
  name: "approve",
  description: "Permission prompt for the studio's claude -p fallback. Not for direct use.",
  qualifiedName: studioToolName("approve"),
  contract: STUDIO_TOOLS.approve,
  inputSchema: PermissionPromptSchema,
  inputShape: PermissionPromptSchema.shape,
  run: async (rawInput, context, signal) => {
    const prompt = PermissionPromptSchema.safeParse(rawInput);
    if (!prompt.success) return toolErrorResult(describeFirstIssue(prompt.error));
    const decision = STUDIO_TOOLS.approve.output.parse(await decide(prompt.data, context, signal));
    return toolResult(decision, false);
  },
};

async function decide(prompt: PermissionPrompt, context: ToolContext, signal: AbortSignal | undefined): Promise<PermissionDecision> {
  if (ALWAYS_ALLOWED_TOOLS.has(prompt.tool_name)) return allow(prompt.input);
  if (prompt.tool_name === "AskUserQuestion") return askQuestions(prompt, context, signal);
  const approval = STUDIO_TOOL_NAME_SET.has(prompt.tool_name) ? findStudioTool(prompt.tool_name)?.approval : undefined;
  if (approval === "auto" || approval === "review" || approval === "gate") return allow(prompt.input);
  return deny(prompt, context, NOT_AVAILABLE);
}

async function askQuestions(prompt: PermissionPrompt, context: ToolContext, signal: AbortSignal | undefined): Promise<PermissionDecision> {
  const parsed = AskUserQuestionInputSchema.safeParse(prompt.input);
  if (!parsed.success) return deny(prompt, context, "The question was malformed");
  const answers = await context.askQuestions(parsed.data.questions, signal);
  if (answers === null) return { behavior: "deny", message: "The question was dismissed" };
  return allow({ ...prompt.input, answers });
}

function allow(input: Record<string, unknown>): PermissionDecision {
  return { behavior: "allow", updatedInput: input };
}

async function deny(prompt: PermissionPrompt, context: ToolContext, reason: string): Promise<PermissionDecision> {
  await context.events.publish({ type: "tool.denied", projectId: context.projectId, name: prompt.tool_name, reason });
  return { behavior: "deny", message: reason };
}
