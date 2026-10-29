// Created by The Angelo Umali.
// Theme packs (plan §7.8): themes/<id>/theme.json from the repo's own themes/ folder, by id only. A theme's look reaches
// Chrome, so v1 never loads one from a URL or an arbitrary path.
const fs = require("fs");
const path = require("path");
const { FAMILIES } = require("./brand/fonts");
const { optionValue } = require("./cli-args");

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

// A project style (work/style.json) may only recolour tokens, swap bundled faces and turn boil: never code, URLs or paths.
const STYLE_KEYS = ["theme", "tokens", "type", "boil"];
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

function applyStyle(pack, style) {
  const fail = (message) => {
    throw new Error(`theme ${pack.id} style: ${message}`);
  };
  if (!isRecord(style)) fail("a style is a JSON object");
  const extraKey = Object.keys(style).find((key) => !STYLE_KEYS.includes(key));
  if (extraKey !== undefined) fail(`${extraKey} cannot be set by a style (${STYLE_KEYS.join(", ")})`);
  if (style.theme !== pack.id) fail(`it names theme ${JSON.stringify(style.theme)}`);
  const styled = structuredClone(pack);
  for (const [name, value] of Object.entries(style.tokens ?? {})) {
    if (!Object.hasOwn(pack.tokens, name)) fail(`the pack has no token ${name}`);
    if (typeof value !== "string" || !HEX_COLOUR.test(value)) fail(`${name} must be a #rrggbb colour`);
    styled.tokens[name] = value;
  }
  for (const [role, family] of Object.entries(style.type ?? {})) {
    if (!TYPE_ROLES.includes(role)) fail(`type role ${role} is not one of ${TYPE_ROLES.join(", ")}`);
    styled.type[role] = { ...pack.type[role], family };
  }
  if (style.boil !== undefined) styled.boil = style.boil;
  return validateTheme(styled);
}

/** An id draws the pack as it is; `{ id, style }` draws it under a project's style. */
function loadTheme(ref = DEFAULT_THEME) {
  if (isRecord(ref)) return applyStyle(loadTheme(ref.id), ref.style);
  const id = ref;
  if (typeof id !== "string" || !THEME_ID.test(id)) throw new Error(`${JSON.stringify(id)} is not a theme id (lowercase letters, digits and -)`);
  const file = path.join(THEMES_DIR, id, "theme.json");
  if (!fs.existsSync(file)) throw new Error(`no theme ${id} in the repo's themes/ folder`);
  // A symlinked folder could point anywhere; the theme's real file must still sit under themes/.
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(THEMES_DIR) + path.sep)) throw new Error(`theme ${id} resolves outside themes/`);
  const theme = JSON.parse(fs.readFileSync(file, "utf8"));
  if (theme.id !== id) throw new Error(`themes/${id}/theme.json says its id is ${JSON.stringify(theme.id)}`);
  return validateTheme(theme);
}

/** A project style file (work/style.json, written by the server) as a loadTheme ref; applyStyle checks it on load. */
function styleRef(file) {
  const style = JSON.parse(fs.readFileSync(file, "utf8"));
  return { id: style.theme, style };
}

/** --style <file> draws a project's style over its theme; else --theme <id>, else the fallback. */
function themeFrom(args, fallback = DEFAULT_THEME) {
  if (args.includes("--style")) return styleRef(optionValue(args, "--style"));
  return args.includes("--theme") ? optionValue(args, "--theme") : fallback;
}

module.exports = { loadTheme, styleRef, themeFrom, validateTheme, DEFAULT_THEME, THEMES_DIR };
