// Created by The Angelo Umali.
// Theme packs (plan §7.8): themes/<id>/theme.json from the repo's own themes/ folder, by id only. A theme's look reaches
// Chrome, so v1 never loads one from a URL or an arbitrary path.
const fs = require("fs");
const path = require("path");
const { FAMILIES } = require("./brand/fonts");

const THEMES_DIR = path.resolve(__dirname, "..", "..", "..", "themes");
const DEFAULT_THEME = "zkidz";
// Lowercase only, no leading `_`: themes/_blueprint is a starter to copy, never a theme to render with.
const THEME_ID = /^[a-z0-9][a-z0-9-]*$/;
const TIERS = ["core", "accent", "special"];
const TYPE_ROLES = ["display", "body", "label", "kicker", "hand", "mono"];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isSlotSet = (slots) => isRecord(slots) && Object.values(slots).every((slot) => Number.isInteger(slot?.maxChars) && slot.maxChars > 0);

function validateTheme(theme) {
  const fail = (message) => {
    throw new Error(`theme ${theme?.id}: ${message}`);
  };
  if (!isRecord(theme)) throw new Error("a theme is a JSON object");
  if (!isRecord(theme.tokens) || !Object.values(theme.tokens).every((value) => typeof value === "string")) fail("tokens map names to colour strings");
  for (const role of TYPE_ROLES) {
    const family = theme.type?.[role]?.family;
    if (!FAMILIES.includes(family)) fail(`type.${role}.family ${JSON.stringify(family)} is not a bundled face (${FAMILIES.join(", ")})`);
  }
  if (typeof theme.boil !== "boolean" || typeof theme.intro !== "boolean") fail("boil and intro are true or false");
  if (!isRecord(theme.components) || !Object.keys(theme.components).length) fail("components lists the kinds it draws");
  for (const [kind, component] of Object.entries(theme.components)) {
    if (!TIERS.includes(component.tier)) fail(`${kind}.tier is ${TIERS.join(", ")}`);
    if (typeof component.purpose !== "string" || !component.purpose.trim()) fail(`${kind}.purpose says what the kind is for`);
    if (!isSlotSet(component.slots ?? {})) fail(`${kind}.slots each need a positive integer maxChars`);
    if (component.tones !== undefined && !(isRecord(component.tones) && Object.values(component.tones).every(isSlotSet))) {
      fail(`${kind}.tones each map slots to a positive integer maxChars`);
    }
  }
  return theme;
}

function loadTheme(id = DEFAULT_THEME) {
  if (typeof id !== "string" || !THEME_ID.test(id)) throw new Error(`${JSON.stringify(id)} is not a theme id (lowercase letters, digits and -)`);
  const file = path.join(THEMES_DIR, id, "theme.json");
  if (!fs.existsSync(file)) throw new Error(`no theme ${id} in the repo's themes/ folder`);
  // A symlinked folder could point anywhere; the theme's real file must still sit under themes/.
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(THEMES_DIR) + path.sep)) throw new Error(`theme ${id} resolves outside themes/`);
  const theme = JSON.parse(fs.readFileSync(file, "utf8"));
  if (theme.id !== id) throw new Error(`themes/${id}/theme.json says its id is ${JSON.stringify(theme.id)}`);
  return validateTheme(theme);
}

module.exports = { loadTheme, validateTheme, DEFAULT_THEME, THEMES_DIR };
