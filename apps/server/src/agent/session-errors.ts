// Created by The Angelo Umali.
// Plan §6.14 order: the api_retry error, then the result's HTTP status, then known message strings, else unknown.
import type { SDKAssistantMessageError } from "@anthropic-ai/claude-agent-sdk";
import type { SESSION_ERROR_KINDS } from "@zks/shared";

export type SessionErrorKind = (typeof SESSION_ERROR_KINDS)[number];

export interface FailedTurn {
  readonly subtype?: string;
  readonly retryError?: SDKAssistantMessageError;
  readonly apiErrorStatus?: number | null;
  readonly text: string;
}

const SUBTYPE_KINDS: Readonly<Record<string, SessionErrorKind>> = { error_max_turns: "max_turns", error_max_budget_usd: "max_budget" };

const RETRY_ERROR_KINDS: Partial<Record<SDKAssistantMessageError, SessionErrorKind>> = {
  authentication_failed: "auth_failed",
  oauth_org_not_allowed: "auth_failed",
  account_on_hold: "auth_failed",
  verification_required: "auth_failed",
  cloud_credential_error: "auth_failed",
  billing_error: "billing_error",
  rate_limit: "rate_limited",
  model_not_found: "model_not_found",
};

const STATUS_KINDS: Readonly<Record<number, SessionErrorKind>> = {
  401: "auth_failed",
  403: "auth_failed",
  402: "billing_error",
  404: "model_not_found",
  429: "rate_limited",
};

const TEXT_KINDS: ReadonlyArray<readonly [RegExp, SessionErrorKind]> = [
  [/credit balance|billing/i, "billing_error"],
  [/invalid api key|\/login|not logged in|authentication/i, "auth_failed"],
  [/rate limit/i, "rate_limited"],
  [/model.*not found|not_found_error/i, "model_not_found"],
];

export function classifySessionError(turn: FailedTurn): SessionErrorKind {
  return (
    (turn.subtype === undefined ? undefined : SUBTYPE_KINDS[turn.subtype]) ??
    (turn.retryError === undefined ? undefined : RETRY_ERROR_KINDS[turn.retryError]) ??
    (turn.apiErrorStatus == null ? undefined : STATUS_KINDS[turn.apiErrorStatus]) ??
    TEXT_KINDS.find(([pattern]) => pattern.test(turn.text))?.[1] ??
    "unknown"
  );
}
