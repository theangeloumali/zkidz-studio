// Created by The Angelo Umali.
import type { ApiErrorCode } from "@zks/shared";
import { ApiError } from "../api/client.ts";

export type StatusTone = "neutral" | "success" | "danger";

const TONE_CLASS: Record<StatusTone, string> = { neutral: "text-copy-muted", success: "text-success", danger: "text-danger" };

/** Always mounted so screen readers hear each change in the live region. */
export function StatusLine({ text, tone }: { readonly text: string; readonly tone: StatusTone }) {
  return (
    <p role="status" className={`min-h-[1lh] text-ui ${TONE_CLASS[tone]}`}>
      {text}
    </p>
  );
}

export function errorText(error: unknown, prefix: string): string {
  return `${prefix}: ${error instanceof Error ? error.message : "unknown error"}`;
}

export function isErrorCode(error: unknown, code: ApiErrorCode): boolean {
  return error instanceof ApiError && error.code === code;
}
