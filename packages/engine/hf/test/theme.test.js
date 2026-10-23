// Created by The Angelo Umali.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadTheme, DEFAULT_THEME } = require("../theme");
const { REGISTRY } = require("../components");
const { canvasBrand } = require("../brand/canvas");

test("zkidz is the default theme and its manifest covers every kind the renderer draws", () => {
  assert.equal(DEFAULT_THEME, "zkidz");
  const theme = loadTheme("zkidz");
  assert.deepEqual(Object.keys(theme.components).sort(), Object.keys(REGISTRY).sort());
  assert.equal(theme.intro, true);
  assert.equal(theme.boil, true);
});

test("minimal proves the contract: no boil, no intro, one sans face, a subset of the kinds", () => {
  const theme = loadTheme("minimal");
  assert.equal(theme.intro, false);
  assert.equal(theme.boil, false);
  assert.deepEqual([...new Set(Object.values(theme.type).map((role) => role.family))], ["Inter"]);
  for (const kind of Object.keys(theme.components)) assert.ok(Object.hasOwn(REGISTRY, kind), kind);
  assert.ok(Object.keys(theme.components).length < Object.keys(REGISTRY).length);
});

test("every component has a tier, a purpose and positive maxChars slots", () => {
  for (const id of ["zkidz", "minimal"]) {
    for (const [kind, component] of Object.entries(loadTheme(id).components)) {
      assert.ok(["core", "accent", "special"].includes(component.tier), `${id} ${kind} tier`);
      assert.ok(component.purpose.length > 10, `${id} ${kind} purpose`);
      const slotSets = [component.slots ?? {}, ...Object.values(component.tones ?? {})];
      for (const slots of slotSets) for (const slot of Object.values(slots)) assert.ok(Number.isInteger(slot.maxChars) && slot.maxChars > 0, `${id} ${kind}`);
    }
  }
});

test("the chip trap is a manifest value: keyword chip text fits 27 chars", () => {
  assert.equal(loadTheme("zkidz").components.keyword.tones.chip.text.maxChars, 27);
});

test("themes load by id from the repo's themes folder only", () => {
  for (const id of ["../themes/zkidz", "/etc", "_blueprint", "ZKidz", "https://example.com/theme", "nope"]) {
    assert.throws(() => loadTheme(id), /theme/, id);
  }
});

test("a theme naming a face the renderer does not bundle is refused", () => {
  const { validateTheme } = require("../theme");
  const theme = structuredClone(loadTheme("minimal"));
  theme.type.body.family = "Comic Sans MS";
  assert.throws(() => validateTheme(theme), /Comic Sans MS/);
});

test("applying zkidz leaves the canvas palette and type exactly as the brand layer defines them", () => {
  const { scope, applyTheme } = canvasBrand();
  const before = JSON.stringify([scope.BRAND, scope.TYPE, scope.C]);
  applyTheme(loadTheme("minimal"));
  assert.notEqual(JSON.stringify([scope.BRAND, scope.TYPE, scope.C]), before);
  applyTheme(loadTheme("zkidz"));
  assert.equal(JSON.stringify([scope.BRAND, scope.TYPE, scope.C]), before);
});

test("minimal's tokens reach the canvas palette and its kit remap", () => {
  const { scope, applyTheme } = canvasBrand();
  const minimal = loadTheme("minimal");
  applyTheme(minimal);
  try {
    assert.equal(scope.BRAND.ink, minimal.tokens.ink);
    assert.equal(scope.C.ink, minimal.tokens.ink);
    assert.equal(scope.TYPE.display.family, "Inter");
  } finally {
    applyTheme(loadTheme("zkidz"));
  }
});

test("minimal draws without boil: a sketched line stays on its row (only the overshoot varies)", () => {
  const { svg, applyTheme } = canvasBrand();
  const rows = (seed) => [
    ...svg(seed, "t", (k) => k.sketchLine(100, 100, 900, 100, { width: 4 })).matchAll(/d="M[\d.]+ ([\d.]+)Q500 ([\d.]+) [\d.]+ ([\d.]+)"/g),
  ];
  const isFlat = (seed) => rows(seed).every((match) => match.slice(1).every((y) => y === "100"));
  assert.equal(isFlat(1), false);
  applyTheme(loadTheme("minimal"));
  try {
    assert.equal(rows(1).length, 2);
    assert.equal(isFlat(1) && isFlat(2), true);
  } finally {
    applyTheme(loadTheme("zkidz"));
  }
});
