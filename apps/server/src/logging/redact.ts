// Created by The Angelo Umali.
// Logs can quote SDK errors and request headers, so credentials and emails are masked before anything is written.
const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]+/g, REDACTED],
  // The header or JSON key stays; its value (to the line end, or the closing quote) goes.
  [/((?:x-api-key|authorization)"?\s*[:=]\s*")[^"]*/gi, `$1${REDACTED}`],
  [/((?:x-api-key|authorization)\s*[:=]\s*)(?!")[^\r\n,}"]+/gi, `$1${REDACTED}`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, REDACTED],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((redactedText, [pattern, replacement]) => redactedText.replace(pattern, replacement), text);
}
