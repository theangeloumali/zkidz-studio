// Created by The Angelo Umali.
// Tool results as MCP CallToolResult: JSON text for the model plus `structuredContent` for the server.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

/** An expected failure the model can act on; its message reaches Claude verbatim, so it never carries a path. */
export class ToolError extends Error {
  override readonly name = "ToolError";
}

export function toolResult(structuredContent: Record<string, unknown>, isError: boolean): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(structuredContent) }];
  return isError ? { content, structuredContent, isError: true } : { content, structuredContent };
}

export function toolErrorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function describeFirstIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  const fieldPath = issue?.path.join(".") ?? "";
  return `Invalid input: ${fieldPath === "" ? "" : `${fieldPath}: `}${issue?.message ?? "rejected"}`;
}
