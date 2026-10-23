// Created by The Angelo Umali.
// The only writer of the rules table (plan §6.9): called from the user's own clicks, never from a tool.
import type { StudioDatabase } from "@zks/db";
import { rules } from "@zks/db/schema";
import { IdSchema, RULES_ENABLED_MAX, type Rule } from "@zks/shared";
import { asc, count, eq } from "drizzle-orm";
import { HttpError, notFound } from "../http/http-error.ts";

type RuleRow = typeof rules.$inferSelect;

function toRuleDto(row: RuleRow): Rule {
  return { id: row.id, text: row.text, sourceQuote: row.sourceQuote, isEnabled: row.enabled, createdAt: row.createdAt.toISOString() };
}

/** A malformed id is a 404, as for projects. */
function parseRuleId(rawRuleId: string): string {
  const ruleId = IdSchema.safeParse(rawRuleId);
  if (!ruleId.success) throw notFound();
  return ruleId.data;
}

type RulesTransaction = Parameters<Parameters<StudioDatabase["transaction"]>[0]>[0];

/** Checked inside the write's transaction; two clicks racing past it can overshoot by one, which only lengthens the prompt. */
async function assertEnabledRoom(transaction: RulesTransaction): Promise<void> {
  const [enabled] = await transaction.select({ total: count() }).from(rules).where(eq(rules.enabled, true));
  if ((enabled?.total ?? 0) >= RULES_ENABLED_MAX) throw new HttpError(409, `At most ${RULES_ENABLED_MAX} rules can be on; turn one off first`);
}

export async function listRules(database: StudioDatabase): Promise<Rule[]> {
  const rows = await database.select().from(rules).orderBy(asc(rules.createdAt));
  return rows.map(toRuleDto);
}

export async function createRule(database: StudioDatabase, input: { readonly text: string; readonly sourceQuote?: string | undefined }): Promise<Rule> {
  const row = await database.transaction(async (transaction) => {
    await assertEnabledRoom(transaction);
    const [inserted] = await transaction
      .insert(rules)
      .values({ text: input.text, sourceQuote: input.sourceQuote ?? null })
      .returning();
    return inserted;
  });
  if (row === undefined) throw new Error("Rule insert returned no row");
  return toRuleDto(row);
}

export async function setRuleEnabled(database: StudioDatabase, rawRuleId: string, isEnabled: boolean): Promise<Rule> {
  const ruleId = parseRuleId(rawRuleId);
  const row = await database.transaction(async (transaction) => {
    const [current] = await transaction.select({ enabled: rules.enabled }).from(rules).where(eq(rules.id, ruleId));
    if (current === undefined) throw notFound();
    if (isEnabled && !current.enabled) await assertEnabledRoom(transaction);
    const [updated] = await transaction.update(rules).set({ enabled: isEnabled }).where(eq(rules.id, ruleId)).returning();
    return updated;
  });
  if (row === undefined) throw notFound();
  return toRuleDto(row);
}

export async function deleteRule(database: StudioDatabase, rawRuleId: string): Promise<void> {
  const deleted = await database
    .delete(rules)
    .where(eq(rules.id, parseRuleId(rawRuleId)))
    .returning({ id: rules.id });
  if (deleted.length === 0) throw notFound();
}
