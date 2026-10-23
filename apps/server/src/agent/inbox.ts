// Created by The Angelo Umali.
// Streaming input for one SDK session: the query stays open between turns and reads the next prompt from here.
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export class PromptInbox implements AsyncIterable<SDKUserMessage> {
  readonly #queued: SDKUserMessage[] = [];
  #wake: (() => void) | undefined;
  #isClosed = false;

  push(text: string): void {
    if (this.#isClosed) return;
    this.#queued.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
    this.#wakeReader();
  }

  close(): void {
    this.#isClosed = true;
    this.#wakeReader();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    for (;;) {
      const next = this.#queued.shift();
      if (next !== undefined) yield next;
      else if (this.#isClosed) return;
      else await new Promise<void>((resolve) => (this.#wake = resolve));
    }
  }

  #wakeReader(): void {
    this.#wake?.();
    this.#wake = undefined;
  }
}
