// Created by The Angelo Umali.
const TOKENS_PER_THOUSAND = 1000;

/** "210k tokens", or the exact count under a thousand so a short session never reads "0k". */
export function formatTokenCount(tokens: number): string {
  return tokens < TOKENS_PER_THOUSAND ? `${tokens} tokens` : `${Math.round(tokens / TOKENS_PER_THOUSAND)}k tokens`;
}
