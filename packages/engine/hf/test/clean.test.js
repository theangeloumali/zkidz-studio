// Created by The Angelo Umali.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { THEMES_DIR } = require("../theme");

// Plan §7.8: no mascot, no third-party logos or marks ship in the renderer or a theme pack.
const BANNED_NAME = /clawd|logos\.js|claude_ai|mascot/i;
const BANNED_TEXT = /clawd|anthropic|claude/i;

function* filesUnder(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* filesUnder(full);
    else yield full;
  }
}

test("the renderer and the theme packs carry no mascot, logo set or Claude mark", () => {
  const offenders = [];
  for (const root of [path.join(__dirname, ".."), THEMES_DIR]) {
    for (const file of filesUnder(root)) {
      if (file === __filename) continue;
      if (BANNED_NAME.test(path.basename(file))) offenders.push(file);
      else if (/\.(js|json|css|html|svg|md)$/.test(file) && BANNED_TEXT.test(fs.readFileSync(file, "utf8"))) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});
