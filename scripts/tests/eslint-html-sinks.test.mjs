// Created by The Angelo Umali.
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: REPO_ROOT });
// The first lint loads typescript-eslint: over 80 s on a loaded 9P mount, so it runs once in a hook with its own timeout.
const WARM_UP_TIMEOUT_MS = 300_000;

/** @param {string} sourceText @param {string} fileName */
async function ruleIdsFor(sourceText, fileName) {
  const [lintResult] = await eslint.lintText(sourceText, { filePath: `${REPO_ROOT}scripts/tests/${fileName}` });
  return (lintResult?.messages ?? []).map((message) => message.ruleId);
}

describe("ESLint HTML sink ban (plan §9.1)", () => {
  beforeAll(async () => {
    await ruleIdsFor("", "warm-up.mjs");
  }, WARM_UP_TIMEOUT_MS);

  it.each([
    ["innerHTML", "element.innerHTML = label;"],
    ["outerHTML", "element.outerHTML = label;"],
    ["insertAdjacentHTML", 'element.insertAdjacentHTML("beforeend", label);'],
  ])("rejects %s", async (_sinkName, statement) => {
    const ruleIds = await ruleIdsFor(`export function paint(element, label) {\n  ${statement}\n}\n`, "sink.mjs");

    expect(ruleIds).toContain("no-restricted-properties");
  });

  it("rejects dangerouslySetInnerHTML as a JSX attribute", async () => {
    const ruleIds = await ruleIdsFor('const label = "x";\nexport const node = <div dangerouslySetInnerHTML={{ __html: label }} />;\n', "sink.jsx");

    expect(ruleIds).toContain("no-restricted-syntax");
  });

  it("rejects dangerouslySetInnerHTML passed as a props object", async () => {
    const ruleIds = await ruleIdsFor('const label = "x";\nexport const props = { dangerouslySetInnerHTML: { __html: label } };\n', "sink.mjs");

    expect(ruleIds).toContain("no-restricted-syntax");
  });

  it("allows plain text content", async () => {
    const ruleIds = await ruleIdsFor("export function paint(element, label) {\n  element.textContent = label;\n}\n", "sink.mjs");

    expect(ruleIds).toEqual([]);
  });
});
