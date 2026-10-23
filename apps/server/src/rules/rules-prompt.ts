// Created by The Angelo Umali.
// The user's style preset and rules as one delimited block appended to the system prompt (plan §6.9), same text for every mode.
import type { StylePreset } from "@zks/shared";

export const RULES_BLOCK_OPEN = "<studio_user_rules>";
export const RULES_BLOCK_CLOSE = "</studio_user_rules>";
const RULES_BLOCK_HEADER = "The user's house style and saved rules for every edit. Their rules win over the style; a request in this session wins over both.";

export interface RulesPromptInput {
  readonly style?: Pick<StylePreset, "name" | "guidance"> | undefined;
  readonly ruleTexts: readonly string[];
}

/** One line of data: escaping the angle brackets means no input, nested or re-cased, can rebuild a delimiter. */
function toDataLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildRulesPromptBlock({ style, ruleTexts }: RulesPromptInput): string {
  if (style === undefined && ruleTexts.length === 0) return "";
  const styleLines = style === undefined ? [] : [`Style preset (${toDataLine(style.name)}): ${toDataLine(style.guidance)}`];
  const ruleLines = ruleTexts.map((ruleText) => `- ${toDataLine(ruleText)}`);
  return [RULES_BLOCK_OPEN, RULES_BLOCK_HEADER, ...styleLines, ...ruleLines, RULES_BLOCK_CLOSE].join("\n");
}
