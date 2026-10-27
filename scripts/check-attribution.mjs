#!/usr/bin/env node
// Created by The Angelo Umali.
// Plan D11: every file that can hold a comment starts with the attribution line in its own syntax.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

const ATTRIBUTION = "Created by The Angelo Umali.";
const UNKNOWN_TYPE_HINT = "a rule in scripts/check-attribution.mjs for this file type";

const SLASH_LINE = `// ${ATTRIBUTION}`;
const HASH_LINE = `# ${ATTRIBUTION}`;
const BLOCK_LINE = `/* ${ATTRIBUTION} */`;
const MARKUP_LINE = `<!-- ${ATTRIBUTION} -->`;

/** @type {Record<string, string>} */
const LINE_BY_EXTENSION = {
  ".ts": SLASH_LINE,
  ".tsx": SLASH_LINE,
  ".mts": SLASH_LINE,
  ".cts": SLASH_LINE,
  ".js": SLASH_LINE,
  ".jsx": SLASH_LINE,
  ".mjs": SLASH_LINE,
  ".cjs": SLASH_LINE,
  ".sh": HASH_LINE,
  ".ps1": HASH_LINE,
  ".py": HASH_LINE,
  ".yaml": HASH_LINE,
  ".yml": HASH_LINE,
  ".toml": HASH_LINE,
  ".css": BLOCK_LINE,
  ".html": MARKUP_LINE,
  ".md": MARKUP_LINE,
  ".svg": MARKUP_LINE,
  ".mmd": `%% ${ATTRIBUTION}`,
  ".sql": `-- ${ATTRIBUTION}`,
  ".cmd": `REM ${ATTRIBUTION}`,
};

/** @type {Record<string, string>} */
const LINE_BY_FILENAME = {
  Dockerfile: HASH_LINE,
  CODEOWNERS: HASH_LINE,
  ".gitignore": HASH_LINE,
  ".gitattributes": HASH_LINE,
  ".prettierignore": HASH_LINE,
  ".dockerignore": HASH_LINE,
  ".editorconfig": HASH_LINE,
  ".env.example": HASH_LINE,
};

// JSON, lockfiles, licence texts and binaries cannot or need not hold the line (D11).
const EXEMPT_EXTENSIONS = new Set([
  ".json",
  // Every NDJSON line must parse as JSON, so a comment line would break the transcript.
  ".ndjson",
  ".lock",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".wav",
  ".m4a",
  ".pdf",
  ".log",
  // pnpm patch-commit writes these and pins their hash in the lockfile.
  ".patch",
]);
const EXEMPT_FILENAMES = new Set([".prettierrc", "pnpm-lock.yaml", "LICENSE", "NOTICE"]);

// drizzle-kit regenerates migration SQL, so it is a generated file under D11 (hand-written rollbacks live elsewhere).
/** @param {string} relativePath */
function isDrizzleMigration(relativePath) {
  return extname(relativePath) === ".sql" && relativePath.split("/").at(-2) === "migrations";
}

/**
 * The header line a file must start with: a string, null when exempt, undefined when no rule covers it.
 * @param {string} relativePath
 * @returns {string | null | undefined}
 */
function expectedHeaderLine(relativePath) {
  const fileName = basename(relativePath);
  const extension = extname(fileName);
  if (EXEMPT_FILENAMES.has(fileName) || EXEMPT_EXTENSIONS.has(extension)) return null;
  if (isDrizzleMigration(relativePath)) return null;
  return LINE_BY_FILENAME[fileName] ?? LINE_BY_EXTENSION[extension];
}

/**
 * Line 1 carries the attribution. Only a shebang, or YAML frontmatter that parsers need on line 1
 * (SKILL.md, GitHub issue templates), may sit above it.
 * @param {string} contents
 * @param {string} headerLine
 */
function startsWithHeader(contents, headerLine) {
  const lines = contents.split(/\r?\n/);
  const [firstLine = "", secondLine = ""] = lines;
  if (firstLine.trimEnd() === headerLine) return true;
  if (firstLine.startsWith("#!")) return secondLine.trimEnd() === headerLine;
  if (headerLine !== MARKUP_LINE || firstLine.trimEnd() !== "---") return false;
  const frontmatterEnd = lines.indexOf("---", 1);
  if (frontmatterEnd === -1) return false;
  const firstBodyLine = lines.slice(frontmatterEnd + 1).find((line) => line.trim() !== "");
  return firstBodyLine?.trimEnd() === headerLine;
}

/** Tracked plus untracked-but-not-ignored files, so a new file is checked before it is staged. @param {string} repoRoot */
function listRepoFiles(repoRoot) {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: repoRoot, encoding: "utf8" });
  const uniquePaths = new Set(output.split("\0").filter(Boolean));
  return [...uniquePaths].filter((relativePath) => existsSync(join(repoRoot, relativePath))).sort();
}

/**
 * @param {string} repoRoot
 * @returns {{ path: string, expected: string }[]}
 */
export function findAttributionProblems(repoRoot) {
  return listRepoFiles(repoRoot).flatMap((relativePath) => {
    const headerLine = expectedHeaderLine(relativePath);
    if (headerLine === null) return [];
    if (headerLine === undefined) return [{ path: relativePath, expected: UNKNOWN_TYPE_HINT }];
    const contents = readFileSync(join(repoRoot, relativePath), "utf8");
    return startsWithHeader(contents, headerLine) ? [] : [{ path: relativePath, expected: headerLine }];
  });
}

function runCli() {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const problems = findAttributionProblems(repoRoot);
  if (problems.length === 0) {
    console.log("attribution: every file carries the line");
    return;
  }
  for (const problem of problems) console.error(`attribution: ${problem.path}: expected ${problem.expected}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) runCli();
