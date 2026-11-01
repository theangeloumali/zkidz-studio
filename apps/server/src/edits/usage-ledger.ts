// Created by The Angelo Umali.
// One project's usage readings. Every report is a session total, so an edit counts each session's growth since the edit opened.
import type { UsageSource } from "@zks/shared";

const USAGE_FIELDS = ["costUsd", "inputTokens", "outputTokens", "cacheTokens"] as const;
type UsageField = (typeof USAGE_FIELDS)[number];
export type UsageReading = Partial<Record<UsageField, number>>;
export type UsageTotals = Record<UsageField, number | null>;

const EMPTY_TOTALS: UsageTotals = { costUsd: null, inputTokens: null, outputTokens: null, cacheTokens: null };

interface SessionReading {
  readonly sessionId: string;
  readonly figures: UsageReading;
}

interface EditTally {
  readonly baselines: Map<string, UsageReading>;
  /** Totals a recovered edit had persisted before a restart. */
  readonly carried: UsageTotals;
  /** After a restart the readings before it are unknown, so a session's first report becomes its baseline. */
  readonly isRecovered: boolean;
  costSource: UsageSource | null;
}

export interface RecoveredTally {
  readonly carried: UsageTotals;
  readonly costSource: UsageSource | null;
}

const keyOf = (sessionId: string, source: UsageSource) => `${sessionId}\u0000${source}`;

export class UsageLedger {
  readonly #latest = new Map<string, SessionReading>();
  #tally: EditTally | undefined;

  hasReading(sessionId: string, source: UsageSource): boolean {
    return this.#latest.has(keyOf(sessionId, source));
  }

  /** A report from an agent: counted from here on while an edit is open. */
  observe(sessionId: string, source: UsageSource, figures: UsageReading): void {
    this.#record(sessionId, source, figures, this.#tally?.isRecovered ?? false);
    if (this.#tally !== undefined && figures.costUsd !== undefined) this.#tally.costSource = source;
  }

  /** Spend a session already had before it was resumed: never counted. */
  seed(sessionId: string, source: UsageSource, figures: UsageReading): void {
    this.#record(sessionId, source, figures, true);
  }

  openEdit(): void {
    const baselines = new Map([...this.#latest].map(([key, reading]) => [key, reading.figures]));
    this.#tally = { baselines, carried: EMPTY_TOTALS, isRecovered: false, costSource: null };
  }

  recoverEdit({ carried, costSource }: RecoveredTally): void {
    this.#tally = { baselines: new Map(), carried, isRecovered: true, costSource };
  }

  closeEdit(): void {
    this.#tally = undefined;
  }

  get costSource(): UsageSource | null {
    return this.#tally?.costSource ?? null;
  }

  totals(): UsageTotals {
    const tally = this.#tally;
    if (tally === undefined) return EMPTY_TOTALS;
    return {
      costUsd: this.#fieldTotal(tally, "costUsd"),
      inputTokens: this.#fieldTotal(tally, "inputTokens"),
      outputTokens: this.#fieldTotal(tally, "outputTokens"),
      cacheTokens: this.#fieldTotal(tally, "cacheTokens"),
    };
  }

  /** Two sources may report the same session, so a session counts its largest growth, never the sum. */
  #fieldTotal(tally: EditTally, field: UsageField): number | null {
    const growthBySession = new Map<string, number>();
    for (const [key, baseline] of tally.baselines) {
      const reading = this.#latest.get(key);
      const latestValue = reading?.figures[field];
      if (reading === undefined || latestValue === undefined) continue;
      const growth = Math.max(0, latestValue - (baseline[field] ?? 0));
      growthBySession.set(reading.sessionId, Math.max(growthBySession.get(reading.sessionId) ?? 0, growth));
    }
    const carried = tally.carried[field];
    if (growthBySession.size === 0) return carried;
    return [...growthBySession.values()].reduce((sum, growth) => sum + growth, carried ?? 0);
  }

  #record(sessionId: string, source: UsageSource, figures: UsageReading, isBaseline: boolean): void {
    const key = keyOf(sessionId, source);
    const previous = this.#latest.get(key);
    const merged = { ...previous?.figures, ...definedFigures(figures) };
    if (this.#tally !== undefined && !this.#tally.baselines.has(key)) {
      this.#tally.baselines.set(key, previous?.figures ?? (isBaseline ? merged : {}));
    }
    this.#latest.set(key, { sessionId, figures: merged });
  }
}

function definedFigures(figures: UsageReading): UsageReading {
  const defined: UsageReading = {};
  for (const field of USAGE_FIELDS) {
    const value = figures[field];
    if (value !== undefined) defined[field] = value;
  }
  return defined;
}
