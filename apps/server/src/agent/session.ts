// Created by The Angelo Umali.
// One SDK session per project (plan §6.12): streaming prompts in, mapped StudioEvents out, init asserted before anything shows.
import type { Options, SDKMessage, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import type { DecisionBroker, PublishEvent } from "./decisions.ts";
import { PromptInbox } from "./inbox.ts";
import { findInitMismatch, type InitExpectations } from "./init-assertion.ts";
import { SdkEventMapper } from "./mapper.ts";
import type { QueryFunction, QueryHandle } from "./query-function.ts";
import { classifySessionError, type SessionErrorKind } from "./session-errors.ts";

/** Mode B with no cloud credentials never sends init; plan §6.6 gives it 30 s. */
const INIT_TIMEOUT_MS = 30_000;
const BINARY_MISSING_PATTERN = /executable not found|ENOENT/i;

export interface AgentSessionOptions {
  readonly projectId: string;
  readonly query: QueryFunction;
  /** Everything but abortController and resume, which the session owns. */
  readonly queryOptions: Options;
  readonly publish: PublishEvent;
  readonly broker: DecisionBroker;
  readonly expectations: InitExpectations;
  readonly cancelProjectJobs: (projectId: string) => Promise<void>;
  readonly resume?: string;
  readonly initTimeoutMs?: number;
  /** Every SDK message after a matching init, for the caller's bookkeeping (session id, turns, cost). */
  readonly onMessage?: (message: SDKMessage) => Promise<void>;
}

export type SessionOutcome =
  { readonly kind: "ended" } | { readonly kind: "failed" } | { readonly kind: "killed" } | { readonly kind: "crashed"; readonly sdkSessionId: string };

export interface AgentSession {
  readonly done: Promise<SessionOutcome>;
  submit(text: string): void;
  /** Interrupts the turn and denies pending cards; the session stays open for the next prompt. */
  stop(): Promise<void>;
  kill(): void;
}

export function createAgentSession(options: AgentSessionOptions): AgentSession {
  return new SdkAgentSession(options);
}

class SdkAgentSession implements AgentSession {
  readonly done: Promise<SessionOutcome>;
  readonly #options: AgentSessionOptions;
  readonly #inbox = new PromptInbox();
  readonly #abort = new AbortController();
  readonly #mapper: SdkEventMapper;
  readonly #handle: QueryHandle;
  #sdkSessionId: string | undefined;
  #outcome: SessionOutcome | undefined;
  #failure: Promise<unknown> = Promise.resolve();

  constructor(options: AgentSessionOptions) {
    this.#options = options;
    this.#mapper = new SdkEventMapper(options.projectId);
    const resume = options.resume === undefined ? {} : { resume: options.resume };
    this.#handle = options.query({
      prompt: this.#inbox,
      projectId: options.projectId,
      options: { ...options.queryOptions, ...resume, abortController: this.#abort },
    });
    this.done = this.#run();
  }

  submit(text: string): void {
    this.#inbox.push(text);
  }

  async stop(): Promise<void> {
    this.#options.broker.cancelProject(this.#options.projectId);
    await Promise.all([this.#handle.interrupt?.(), this.#options.cancelProjectJobs(this.#options.projectId)]);
  }

  kill(): void {
    this.#end({ kind: "killed" });
  }

  async #run(): Promise<SessionOutcome> {
    const timer = setTimeout(
      () => this.#fail("auth_failed", "Claude did not start in time. Check the cloud credentials."),
      this.#options.initTimeoutMs ?? INIT_TIMEOUT_MS,
    );
    try {
      for await (const message of this.#handle) {
        if (!(await this.#accept(message, timer))) break;
      }
    } catch (error) {
      this.#onError(error);
    } finally {
      clearTimeout(timer);
      this.#inbox.close();
    }
    await this.#failure;
    return this.#outcome ?? { kind: "ended" };
  }

  async #accept(message: SDKMessage, timer: NodeJS.Timeout): Promise<boolean> {
    if (this.#outcome !== undefined) return false;
    if (message.type === "system" && message.subtype === "init") {
      clearTimeout(timer);
      if (!this.#checkInit(message)) return false;
    }
    for (const event of this.#mapper.map(message)) await this.#options.publish(event);
    await this.#options.onMessage?.(message);
    return true;
  }

  #checkInit(init: SDKSystemMessage): boolean {
    const problem = findInitMismatch(init, this.#options.expectations);
    if (problem === null) {
      this.#sdkSessionId = init.session_id;
      return true;
    }
    const kind = init.apiKeySource === this.#options.expectations.apiKeySource ? "unknown" : "credential_mismatch";
    this.#fail(kind, `The session did not start as configured (${problem}).`);
    return false;
  }

  #onError(error: unknown): void {
    if (this.#outcome !== undefined) return;
    if (this.#sdkSessionId !== undefined) {
      this.#end({ kind: "crashed", sdkSessionId: this.#sdkSessionId });
      return;
    }
    const text = error instanceof Error ? error.message : "The agent failed to start";
    this.#fail(BINARY_MISSING_PATTERN.test(text) ? "sdk_binary_missing" : classifySessionError({ text }), text);
  }

  #fail(kind: SessionErrorKind, message: string): void {
    if (this.#outcome !== undefined) return;
    this.#failure = this.#options.publish({ type: "session.error", projectId: this.#options.projectId, kind, message });
    this.#end({ kind: "failed" });
  }

  #end(outcome: SessionOutcome): void {
    this.#outcome ??= outcome;
    this.#options.broker.cancelProject(this.#options.projectId);
    this.#abort.abort();
    this.#handle.close?.();
  }
}
