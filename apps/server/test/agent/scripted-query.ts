// Created by The Angelo Umali.
// A QueryFunction double the test drives message by message; it records prompts, options and control calls.
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { QueryFunction, QueryHandle } from "../../src/agent/query-function.ts";

type Step = { readonly kind: "message"; readonly message: SDKMessage } | { readonly kind: "fail"; readonly error: Error } | { readonly kind: "end" };

/** One per query call, so closing a crashed handle never ends the resumed one. */
class StepChannel {
  readonly #steps: Step[] = [];
  #wake: (() => void) | undefined;

  push(step: Step): void {
    this.#steps.push(step);
    this.#wake?.();
    this.#wake = undefined;
  }

  async *messages(): AsyncGenerator<SDKMessage> {
    for (;;) {
      const step = this.#steps.shift();
      if (step === undefined) await new Promise<void>((resolve) => (this.#wake = resolve));
      else if (step.kind === "message") yield step.message;
      else if (step.kind === "fail") throw step.error;
      else return;
    }
  }
}

export class ScriptedQuery {
  readonly calls: Options[] = [];
  readonly prompts: string[] = [];
  interrupts = 0;
  closes = 0;
  #latest = new StepChannel();
  #hasCall = false;

  readonly query: QueryFunction = ({ prompt, options }) => {
    this.calls.push(options);
    // Steps scripted before the first call belong to it.
    if (this.#hasCall) this.#latest = new StepChannel();
    this.#hasCall = true;
    void this.#readPrompts(prompt);
    return this.#handle(this.#latest);
  };

  /** Emits on the most recent query call. */
  emit(message: SDKMessage): void {
    this.#latest.push({ kind: "message", message });
  }

  fail(error: Error): void {
    this.#latest.push({ kind: "fail", error });
  }

  end(): void {
    this.#latest.push({ kind: "end" });
  }

  #handle(channel: StepChannel): QueryHandle {
    const messages = channel.messages();
    return {
      [Symbol.asyncIterator]: () => messages,
      interrupt: () => {
        this.interrupts += 1;
        return Promise.resolve(undefined);
      },
      close: () => {
        this.closes += 1;
        channel.push({ kind: "end" });
      },
    };
  }

  async #readPrompts(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const message of prompt) {
      this.prompts.push(typeof message.message.content === "string" ? message.message.content : "");
    }
  }
}

export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
