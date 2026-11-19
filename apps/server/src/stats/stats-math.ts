// Created by The Angelo Umali.
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const THURSDAY = 4;

/** ISO-8601 week in UTC, like 2026-W47: the week's Thursday decides its year. */
export function isoWeekOf(date: Date): string {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoWeekday = thursday.getUTCDay() || DAYS_PER_WEEK;
  thursday.setUTCDate(thursday.getUTCDate() + THURSDAY - isoWeekday);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / DAY_MS + 1) / DAYS_PER_WEEK);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Tallies items under a key, keeping the first item seen as the group's sample. */
export function countBy<Item>(items: readonly Item[], keyOf: (item: Item) => string): Map<string, { sample: Item; count: number }> {
  const groups = new Map<string, { sample: Item; count: number }>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { sample: item, count: 1 });
    else group.count += 1;
  }
  return groups;
}

export function rangeStart(range: "7d" | "30d" | "all", now: Date): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * DAY_MS);
}
