// Created by The Angelo Umali.

/** A half-open span of seconds, in source or edited time depending on where it is used. */
export interface TimeSpan {
  readonly at: number;
  readonly end: number;
}

export function editedDuration(spans: readonly TimeSpan[]): number {
  return spans.reduce((total, span) => total + span.end - span.at, 0);
}

/** A removed source time maps to where the edit resumes. */
export function sourceToEdited(spans: readonly TimeSpan[], sourceS: number): number {
  let editedStart = 0;
  for (const span of spans) {
    if (sourceS < span.end) return editedStart + Math.max(0, sourceS - span.at);
    editedStart += span.end - span.at;
  }
  return editedStart;
}

export function editedToSource(spans: readonly TimeSpan[], editedS: number): number {
  let remaining = Math.max(0, editedS);
  for (const span of spans) {
    const spanLength = span.end - span.at;
    if (remaining < spanLength) return span.at + remaining;
    remaining -= spanLength;
  }
  return spans.at(-1)?.end ?? 0;
}
