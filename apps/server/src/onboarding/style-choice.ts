// Created by The Angelo Umali.
// The house style setting: GET/PUT /api/style and every new session's system prompt read the same key and default.
import type { StudioDatabase } from "@zks/db";
import { StyleChoiceSchema, type StyleId } from "@zks/shared";
import { readSettingValue, writeSettingValue } from "../auth/settings-store.ts";

export interface StyleChoice {
  readonly styleId: StyleId;
}

const STYLE_KEY = "style";
const DEFAULT_STYLE_CHOICE: StyleChoice = { styleId: "zkidz" };

export async function readStyleChoice(database: StudioDatabase): Promise<StyleChoice> {
  return (await readSettingValue(database, STYLE_KEY, StyleChoiceSchema)) ?? DEFAULT_STYLE_CHOICE;
}

export function writeStyleChoice(database: StudioDatabase, choice: StyleChoice): Promise<void> {
  return writeSettingValue(database, STYLE_KEY, choice);
}
