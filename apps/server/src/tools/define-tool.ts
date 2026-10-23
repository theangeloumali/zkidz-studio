// Created by The Angelo Umali.
// Binds a shared tool contract (packages/shared/src/tools) to its handler, with input and output checked by the contract.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { STUDIO_TOOLS, studioToolName, type StudioToolContract, type StudioToolName } from "@zks/shared";
import { z } from "zod";
import type { ToolContext } from "./context.ts";
import { describeFirstIssue, toolErrorResult, toolResult, ToolError } from "./result.ts";

type Contracts = typeof STUDIO_TOOLS;
type ToolInput<Name extends StudioToolName> = z.output<Contracts[Name]["input"]>;
type ToolOutput<Name extends StudioToolName> = z.input<Contracts[Name]["output"]>;

interface HandlerOutcome<Output> {
  readonly output: Output;
  /** validate_spec reports its errors as structured output and still flags the call as failed. */
  readonly isError?: boolean;
}

type ToolHandler<Name extends StudioToolName> = (
  input: ToolInput<Name>,
  context: ToolContext,
  signal: AbortSignal | undefined,
) => Promise<HandlerOutcome<ToolOutput<Name>>>;

export interface ToolImplementation<Name extends StudioToolName> {
  /** What Claude reads to pick the tool. */
  readonly description: string;
  readonly handler: ToolHandler<Name>;
}

export interface StudioTool {
  readonly name: StudioToolName;
  readonly description: string;
  readonly qualifiedName: string;
  readonly contract: StudioToolContract;
  /** The schema calls are parsed with; the stdio twin lists it. */
  readonly inputSchema: z.ZodObject;
  readonly inputShape: z.ZodRawShape;
  readonly run: (rawInput: unknown, context: ToolContext, signal?: AbortSignal) => Promise<CallToolResult>;
}

export function implementTool<Name extends StudioToolName>(name: Name, { description, handler }: ToolImplementation<Name>): StudioTool {
  const contract: StudioToolContract = STUDIO_TOOLS[name];
  if (!(contract.input instanceof z.ZodObject)) throw new Error(`${name} input must be an object schema`);
  return {
    name,
    description,
    qualifiedName: studioToolName(name),
    contract,
    inputSchema: contract.input,
    inputShape: contract.input.shape,
    run: async (rawInput, context, signal) => {
      const parsedInput = STUDIO_TOOLS[name].input.safeParse(rawInput);
      if (!parsedInput.success) return toolErrorResult(describeFirstIssue(parsedInput.error));
      try {
        // Parsed by this tool's own contract; TS cannot correlate STUDIO_TOOLS[name] with Name, hence the cast.
        const outcome = await handler(parsedInput.data as ToolInput<Name>, context, signal);
        const output: unknown = contract.output.parse(outcome.output);
        if (!isRecord(output)) throw new Error(`${name} output is not an object`);
        return toolResult(output, outcome.isError === true);
      } catch (error) {
        if (error instanceof ToolError) return toolErrorResult(error.message);
        throw error;
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
