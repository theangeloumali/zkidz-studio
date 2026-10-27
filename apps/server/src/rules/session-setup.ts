// Created by The Angelo Umali.
// What a new agent session reads at start: the project's limits and the style-plus-rules block, so a change saved now reaches the next session.
import type { StudioDatabase } from "@zks/db";
import type { StyleCard } from "@zks/shared";
import { DEFAULT_PRESETS_DIR, loadPresets } from "../onboarding/presets.ts";
import { readStyleChoice } from "../onboarding/style-choice.ts";
import { readProjectSettings } from "./project-settings.ts";
import { readEnabledRuleTexts } from "./rule-reader.ts";
import { buildRulesPromptBlock } from "./rules-prompt.ts";

export interface SessionSetup {
  readonly limits: { readonly maxTurns: number; readonly maxBudgetUsd: number };
  readonly systemPromptAppend: string;
}

let shippedStyles: Promise<readonly StyleCard[]> | undefined;

async function readHouseStyle(database: StudioDatabase): Promise<StyleCard | undefined> {
  const { styleId } = await readStyleChoice(database);
  const styles = await (shippedStyles ??= loadPresets(DEFAULT_PRESETS_DIR).then((presets) => presets.styles));
  return styles.find((style) => style.id === styleId);
}

/** The same text for the SDK path and the file terminal mode passes with --append-system-prompt-file. */
export async function loadRulesPromptBlock(database: StudioDatabase): Promise<string> {
  const [style, ruleTexts] = await Promise.all([readHouseStyle(database), readEnabledRuleTexts(database)]);
  return buildRulesPromptBlock({ style, ruleTexts });
}

export async function loadSessionSetup(database: StudioDatabase, projectId: string): Promise<SessionSetup> {
  const [projectSettings, systemPromptAppend] = await Promise.all([readProjectSettings(database, projectId), loadRulesPromptBlock(database)]);
  return { limits: { maxTurns: projectSettings.maxTurns, maxBudgetUsd: projectSettings.budgetUsd }, systemPromptAppend };
}
