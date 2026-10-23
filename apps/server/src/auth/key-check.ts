// Created by The Angelo Umali.
// Mode A key check (plan §6.5). The URL is a literal so ANTHROPIC_BASE_URL cannot redirect a user's key elsewhere.
import type { Logger } from "../logging/logger.ts";

export const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";
const KEY_CHECK_TIMEOUT_MS = 10_000;

export type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type KeyCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "rejected" | "unexpected"; readonly status: number }
  | { readonly ok: false; readonly reason: "unreachable" };

export interface KeyCheckDependencies {
  readonly fetch: FetchFunction;
  readonly logger: Logger;
}

export async function checkApiKey(apiKey: string, dependencies: KeyCheckDependencies): Promise<KeyCheckResult> {
  let response: Response;
  try {
    response = await dependencies.fetch(ANTHROPIC_MODELS_URL, {
      method: "GET",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    });
  } catch (error) {
    // Only the error's class: a fetch error message can echo request details.
    dependencies.logger.warn("api key check could not reach Anthropic", { errorName: error instanceof Error ? error.name : typeof error });
    return { ok: false, reason: "unreachable" };
  }
  await response.body?.cancel();
  if (response.status === 200) return { ok: true };
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "rejected", status: response.status };
  return { ok: false, reason: "unexpected", status: response.status };
}
