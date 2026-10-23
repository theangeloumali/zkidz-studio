// Created by The Angelo Umali.
// Cards the agent waits on (approvals, questions, cut reviews); the decide route settles them by requestId.
import { randomUUID } from "node:crypto";
import type { ApprovalCard, DecisionRequestSchema, StudioEvent } from "@zks/shared";
import type { z } from "zod";
import type { NewStudioEvent } from "../events/event-bus.ts";
import type { AskedQuestions, QuestionAnswers } from "../tools/context.ts";

export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;
type DecisionKind = DecisionRequest["kind"];
export type PublishEvent = (event: NewStudioEvent) => Promise<StudioEvent>;

export type { ApprovalCard };

export interface CardRequest {
  readonly projectId: string;
  readonly kind: DecisionKind;
  /** Builds the card event once the requestId exists. */
  readonly card: (requestId: string) => NewStudioEvent;
  readonly signal?: AbortSignal;
}

interface PendingCard {
  readonly projectId: string;
  readonly kind: DecisionKind;
  readonly resolve: (decision: DecisionRequest | null) => void;
}

export class DecisionBroker {
  /** Also used by the decider for tool.denied, so cards and denials share one ordered channel. */
  readonly publish: PublishEvent;
  readonly #pending = new Map<string, PendingCard>();

  constructor(options: { publish: PublishEvent }) {
    this.publish = options.publish;
  }

  /** Resolves to null when the card is cancelled (stop, kill, abort), which every caller treats as deny. */
  async ask(request: CardRequest): Promise<DecisionRequest | null> {
    if (request.signal?.aborted === true) return null;
    const requestId = randomUUID();
    const decision = new Promise<DecisionRequest | null>((resolve) => {
      this.#pending.set(requestId, { projectId: request.projectId, kind: request.kind, resolve });
    });
    request.signal?.addEventListener("abort", () => this.#finish(requestId, null), { once: true });
    await this.publish(request.card(requestId));
    return decision;
  }

  /** Rio's ToolContext.requestApproval: a gate card for a studio tool. */
  async requestApproval(projectId: string, card: ApprovalCard, signal?: AbortSignal): Promise<"allow" | "deny"> {
    const decision = await this.ask({
      projectId,
      kind: "approval",
      signal,
      card: (requestId) => ({ type: "approval.requested", projectId, requestId, ...card }),
    });
    return decision?.kind === "approval" ? decision.decision : "deny";
  }

  /** A question.asked card; null when dismissed or cancelled. */
  async askQuestions(projectId: string, questions: AskedQuestions, signal?: AbortSignal): Promise<QuestionAnswers | null> {
    const decision = await this.ask({
      projectId,
      kind: "question",
      signal,
      card: (requestId) => ({ type: "question.asked", projectId, requestId, questions: [...questions] }),
    });
    return decision?.kind === "question" ? decision.answers : null;
  }

  /** False when no card of that kind is waiting in that project, so a stale or forged decision is a 404. */
  settle(projectId: string, decision: DecisionRequest): boolean {
    const pending = this.#pending.get(decision.requestId);
    if (pending?.projectId !== projectId || pending.kind !== decision.kind) return false;
    this.#finish(decision.requestId, decision);
    return true;
  }

  cancelProject(projectId: string): void {
    for (const [requestId, pending] of this.#pending) {
      if (pending.projectId === projectId) this.#finish(requestId, null);
    }
  }

  #finish(requestId: string, decision: DecisionRequest | null): void {
    this.#pending.get(requestId)?.resolve(decision);
    this.#pending.delete(requestId);
  }
}
