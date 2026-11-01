// Created by The Angelo Umali.
// The renderers' theme flags: --theme names a pack, --style draws a project's style file over its theme (slice D).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { themeFrom } = require("../theme");

test("no flag draws the default pack, and --theme names one", () => {
  assert.equal(themeFrom([]), "zkidz");
  assert.equal(themeFrom(["--theme", "minimal"]), "minimal");
});

test("--style reads the project's style file and draws its theme under it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zks-style-"));
  const style = { theme: "minimal", tokens: { ink: "#101820" } };
  fs.writeFileSync(path.join(dir, "style.json"), JSON.stringify(style));
  try {
    assert.deepEqual(themeFrom(["--stills", "1", "--style", path.join(dir, "style.json")]), { id: "minimal", style });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--style with no file is refused rather than taking the next flag", () => {
  assert.throws(() => themeFrom(["--style", "--events"]), /--style is required/);
});
