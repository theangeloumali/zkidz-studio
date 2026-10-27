// Created by The Angelo Umali.
// The SDK's query() narrowed to what the studio uses, so tests, the replay harness and the `-p` runner can stand in for it.
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export type QueryHandle = AsyncIterable<SDKMessage> & Partial<Pick<Query, "interrupt" | "close">>;

/** The SDK ignores projectId; the `-p` runner maps its MCP twin session to that project. */
export type QueryFunction = (params: { readonly prompt: AsyncIterable<SDKUserMessage>; readonly projectId: string; readonly options: Options }) => QueryHandle;

/** A handle whose query is still being built: iteration, interrupt and close wait for it. */
export function deferredQueryHandle(pending: Promise<QueryHandle>): QueryHandle {
  return {
    async *[Symbol.asyncIterator]() {
      yield* await pending;
    },
    interrupt: async () => {
      await (await pending).interrupt?.();
    },
    close: () => {
      pending.then(
        (handle) => handle.close?.(),
        () => undefined,
      );
    },
  };
}
