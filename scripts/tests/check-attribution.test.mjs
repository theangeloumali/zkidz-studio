// Created by The Angelo Umali.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findAttributionProblems } from "../check-attribution.mjs";

const CHECKER_PATH = fileURLToPath(new URL("../check-attribution.mjs", import.meta.url));
const ATTRIBUTION = "Created by The Angelo Umali.";

let repoDir = "";

/** @param {string} relativePath @param {string} contents */
function writeRepoFile(relativePath, contents) {
  const filePath = join(repoDir, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "zks-attribution-"));
  execFileSync("git", ["init", "--quiet"], { cwd: repoDir });
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("findAttributionProblems", () => {
  it("passes files that start with the line in their own comment syntax", () => {
    writeRepoFile("src/a.ts", `// ${ATTRIBUTION}\nexport const a = 1;\n`);
    writeRepoFile("styles.css", `/* ${ATTRIBUTION} */\nbody {}\n`);
    writeRepoFile("README.md", `<!-- ${ATTRIBUTION} -->\n\n# Title\n`);
    writeRepoFile("config.yaml", `# ${ATTRIBUTION}\nkey: 1\n`);
    writeRepoFile("flow.mmd", `%% ${ATTRIBUTION}\nflowchart TB\n`);
    writeRepoFile("db/0001.down.sql", `-- ${ATTRIBUTION}\nselect 1;\n`);
    writeRepoFile(".gitignore", `# ${ATTRIBUTION}\nnode_modules/\n`);
    writeRepoFile("Dockerfile", `# ${ATTRIBUTION}\nFROM scratch\n`);

    expect(findAttributionProblems(repoDir)).toEqual([]);
  });

  it("reports a source file that is missing the line", () => {
    writeRepoFile("src/missing.ts", "export const missing = 1;\n");

    expect(findAttributionProblems(repoDir)).toEqual([{ path: "src/missing.ts", expected: `// ${ATTRIBUTION}` }]);
  });

  it("reports the line written in the wrong comment syntax", () => {
    writeRepoFile("tool.py", `// ${ATTRIBUTION}\nprint(1)\n`);

    expect(findAttributionProblems(repoDir)).toEqual([{ path: "tool.py", expected: `# ${ATTRIBUTION}` }]);
  });

  it("requires Markdown to carry the line on line 1", () => {
    writeRepoFile("docs/late.md", `# Title\n\n<!-- ${ATTRIBUTION} -->\n`);

    expect(findAttributionProblems(repoDir)).toEqual([{ path: "docs/late.md", expected: `<!-- ${ATTRIBUTION} -->` }]);
  });

  it("accepts the line right after YAML frontmatter, which must stay on line 1", () => {
    writeRepoFile(".github/ISSUE_TEMPLATE/bug.md", `---\nname: Bug\n---\n\n<!-- ${ATTRIBUTION} -->\n\nBody\n`);
    writeRepoFile("skills/hello/SKILL.md", `---\nname: hello\n---\n<!-- ${ATTRIBUTION} -->\n`);

    expect(findAttributionProblems(repoDir)).toEqual([]);
  });

  it("still reports frontmatter Markdown with the line further down", () => {
    writeRepoFile("skills/late/SKILL.md", `---\nname: late\n---\n\n# Title\n\n<!-- ${ATTRIBUTION} -->\n`);

    expect(findAttributionProblems(repoDir)).toEqual([{ path: "skills/late/SKILL.md", expected: `<!-- ${ATTRIBUTION} -->` }]);
  });

  it("exempts generated files: tool logs and drizzle-kit migrations", () => {
    writeRepoFile("results/run.log", "output\n");
    writeRepoFile("packages/db/migrations/0000_sticky_cobalt_man.sql", 'CREATE SCHEMA "studio";\n');

    expect(findAttributionProblems(repoDir)).toEqual([]);
  });

  it("accepts the line right after a shebang", () => {
    writeRepoFile("bin/run.mjs", `#!/usr/bin/env node\n// ${ATTRIBUTION}\n`);

    expect(findAttributionProblems(repoDir)).toEqual([]);
  });

  it("exempts JSON, lockfiles, licence texts and binaries", () => {
    writeRepoFile("package.json", "{}\n");
    writeRepoFile("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    writeRepoFile("LICENSE", "Apache License\n");
    writeRepoFile("fonts/OFL-Archivo.txt", "Copyright\n");
    writeRepoFile("shot.png", "binary");

    expect(findAttributionProblems(repoDir)).toEqual([]);
  });

  it("skips files that git ignores", () => {
    writeRepoFile(".gitignore", `# ${ATTRIBUTION}\nignored/\n`);
    writeRepoFile("ignored/a.ts", "export {};\n");

    expect(findAttributionProblems(repoDir)).toEqual([]);
  });

  it("reports a file type with no rule so a new type cannot slip through", () => {
    writeRepoFile("notes.weird", "hello\n");

    expect(findAttributionProblems(repoDir)).toEqual([{ path: "notes.weird", expected: "a rule in scripts/check-attribution.mjs for this file type" }]);
  });
});

describe("check-attribution CLI", () => {
  it("exits 1 and names the file when a line is missing", () => {
    writeRepoFile("src/missing.ts", "export {};\n");

    let exitCode = 0;
    let stderr = "";
    try {
      execFileSync("node", [CHECKER_PATH], { cwd: repoDir, stdio: "pipe" });
    } catch (error) {
      const failedRun = /** @type {{ status: number, stderr: Buffer }} */ (error);
      exitCode = failedRun.status;
      stderr = failedRun.stderr.toString();
    }

    expect(exitCode).toBe(1);
    expect(stderr).toContain("src/missing.ts");
  });

  it("exits 0 when every file carries the line", () => {
    writeRepoFile("src/ok.ts", `// ${ATTRIBUTION}\n`);

    expect(() => execFileSync("node", [CHECKER_PATH], { cwd: repoDir, stdio: "pipe" })).not.toThrow();
  });
});
