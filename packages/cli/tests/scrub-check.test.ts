// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DENY_LIST_FILE, loadDenyTerms, runScrubCheck, scanPaths, scanText, type ScrubRule } from "../src/commands/scrub-check.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// Each spawn loads the CLI cold; on a slow filesystem (WSL /mnt) that alone takes ~4 s.
const SUBPROCESS_TIMEOUT_MS = 30_000;
const PLANTED_CLIENT = "Fernwood Dental";
const scratchDirs: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "zks-scrub-"));
  scratchDirs.push(dir);
  return dir;
}

/** Plants files (relative path → content) under a fresh scratch tree. */
function plantTree(files: Record<string, string | Buffer>): string {
  const root = scratchDir();
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  return root;
}

function rulesIn(text: string, filePath = "notes.md", denyTerms: string[] = []): ScrubRule[] {
  return scanText(filePath, text, denyTerms).map((finding) => finding.rule);
}

/** A ZKS_HOME whose deny list holds only the planted client, so the client-name rule is armed. */
function seededHome(): string {
  return plantTree({ [DENY_LIST_FILE]: `${PLANTED_CLIENT}\n` });
}

function skillWithFrontmatter(frontmatter: string): string {
  return `---\nname: s\ndescription: d\n${frontmatter}\n---\n\n# Body\n`;
}

/** The exit-code rules run in-process: a cold CLI spawn per case overran the timeout under ci:local's parallel lanes. */
function runScrubCheckCaptured(args: string[], zksHome = seededHome()) {
  const stdoutLines: unknown[] = [];
  const stderrLines: unknown[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void stdoutLines.push(line));
  const errorSpy = vi.spyOn(console, "error").mockImplementation((line: unknown) => void stderrLines.push(line));
  try {
    const status = runScrubCheck(args, zksHome);
    return { status, stdout: stdoutLines.join("\n"), stderr: stderrLines.join("\n") };
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe("scanText", () => {
  it("passes ordinary skill prose", () => {
    expect(
      rulesIn("Trim pauses over 0.6 s. Use ffmpeg 8.1.3 and keep captions at bottom 1750.\nSee ~/.local/share and settings.local.json and .env.local."),
    ).toEqual([]);
  });

  it("flags a deny-listed client name case-insensitively on word boundaries only", () => {
    expect(rulesIn(`Edit for ${PLANTED_CLIENT.toUpperCase()} today`, "a.md", [PLANTED_CLIENT])).toEqual(["client-name"]);
    expect(rulesIn("Fernwood Dentalcare is a different word", "a.md", [PLANTED_CLIENT])).toEqual([]);
  });

  it("flags a real email address but not reserved example domains", () => {
    expect(rulesIn("Contact owner@fernwood-dental.com")).toEqual(["email"]);
    expect(rulesIn("Use you@example.com or ops@example.org")).toEqual([]);
  });

  it("flags private hostnames", () => {
    for (const host of ["nas.local:5000", "build.internal", "box.tail1234.ts.net", "router.lan", "files.home.arpa"]) {
      expect(rulesIn(`open http://${host}/x`), host).toEqual(["hostname"]);
    }
  });

  it("flags private and tailnet IPs but not loopback, public IPs or version strings", () => {
    for (const address of ["192.168.1.20", "10.0.0.5", "172.20.1.1", "100.101.102.103", "169.254.3.4"]) {
      expect(rulesIn(`host ${address}:8080`), address).toEqual(["private-ip"]);
    }
    expect(rulesIn("127.0.0.1 and 8.8.8.8 and 172.32.0.1 and v1.10.0.5.2 and 999.1.1.1")).toEqual([]);
  });

  it("flags personal home paths on every OS", () => {
    for (const personalPath of ["/home/jdoe/footage", "/Users/jdoe/Movies", "C:\\Users\\jdoe\\Videos", "C:\\\\Users\\\\jdoe", "/mnt/c/Users/jdoe/Desktop"]) {
      expect(rulesIn(`source: ${personalPath}`), personalPath).toEqual(["personal-path"]);
    }
  });

  it("allows placeholder home paths", () => {
    expect(rulesIn("/home/<user>/x /Users/$USER/x C:\\Users\\%USERNAME%\\x /home/user/x /Users/Shared/x /home/runner/work C:/Users/*/AppData")).toEqual([]);
  });

  it("flags hooks and mcpServers declared in plugin.json", () => {
    expect(rulesIn(JSON.stringify({ name: "p", hooks: {} }), "plugin/.claude-plugin/plugin.json")).toEqual(["plugin-hooks"]);
    expect(rulesIn(JSON.stringify({ name: "p", mcpServers: {} }), "plugin.json")).toEqual(["plugin-mcp-servers"]);
    expect(rulesIn(JSON.stringify({ name: "p", description: "hooks and mcpServers in prose" }), "plugin.json")).toEqual([]);
  });

  it("flags plugin hook, MCP and LSP config files wherever they sit in the tree", () => {
    expect(rulesIn(JSON.stringify({ hooks: { SessionStart: [] } }), "plugin/hooks/hooks.json")).toEqual(["plugin-hooks"]);
    expect(rulesIn(JSON.stringify({ mcpServers: {} }), "plugin/.mcp.json")).toEqual(["plugin-mcp-servers"]);
    expect(rulesIn("{}", "plugin/.lsp.json")).toEqual(["plugin-lsp-servers"]);
    expect(rulesIn(JSON.stringify({ name: "p", lspServers: {} }), "plugin.json")).toEqual(["plugin-lsp-servers"]);
    expect(rulesIn("{}", "plugin/data/hooks.json")).toEqual([]);
  });

  it("flags hooks declared in skill, agent and command frontmatter", () => {
    for (const file of ["plugin/skills/s/SKILL.md", "plugin/agents/a.md", "plugin/commands/c.md"]) {
      expect(rulesIn(skillWithFrontmatter("hooks:\n  PreToolUse: []"), file), file).toEqual(["skill-hooks"]);
    }
    expect(rulesIn("# Notes\n\nhooks: are banned", "plugin/skills/s/SKILL.md")).toEqual([]);
    expect(rulesIn(skillWithFrontmatter("hooks: {}"), "docs/notes.md")).toEqual([]);
  });

  it("flags allowed-tools that grant shell, file-write or web tools, inline or as a list", () => {
    const skill = "plugin/skills/s/SKILL.md";
    for (const grant of ["Bash(*)", "Read, Edit", "[Read, Write]", "WebFetch", "Bash(git status:*)", "MultiEdit"]) {
      expect(rulesIn(skillWithFrontmatter(`allowed-tools: ${grant}`), skill), grant).toEqual(["skill-allowed-tools"]);
    }
    expect(rulesIn(skillWithFrontmatter("allowed-tools:\n  - Read\n  - WebSearch"), skill)).toEqual(["skill-allowed-tools"]);
    expect(rulesIn(skillWithFrontmatter("allowed-tools: Read, Grep, Glob, mcp__studio__set_cuts"), skill)).toEqual([]);
  });

  it("flags an unparseable plugin.json instead of passing it", () => {
    expect(rulesIn("{ name: ", "plugin.json")).toEqual(["plugin-invalid-json"]);
  });

  it("flags <script and eval inside prompts/ only", () => {
    expect(rulesIn('<SCRIPT src="x">', "plugin/prompts/system.md")).toEqual(["prompt-script"]);
    expect(rulesIn("then eval(payload)", "prompts/a.txt")).toEqual(["prompt-script"]);
    expect(rulesIn("evaluate the opening", "prompts/a.txt")).toEqual([]);
    expect(rulesIn("<script> eval(x)", "docs/notes.md")).toEqual([]);
  });

  it("reports 1-based line and column", () => {
    expect(scanText("a.md", "ok\n  see 10.1.2.3", [])).toEqual([{ file: "a.md", line: 2, column: 7, rule: "private-ip", match: "10.1.2.3" }]);
  });
});

describe("loadDenyTerms", () => {
  it("reads one term per line from ZKS_HOME, skipping blanks and comments", () => {
    const home = plantTree({ [DENY_LIST_FILE]: `# clients\n\n  ${PLANTED_CLIENT}  \nAcme Rockets\n` });
    expect(loadDenyTerms(home)).toEqual([PLANTED_CLIENT, "Acme Rockets"]);
  });

  it("returns no terms when the deny list is absent", () => {
    expect(loadDenyTerms(scratchDir())).toEqual([]);
  });
});

describe("scanPaths", () => {
  it("walks directories, skipping node_modules, .git and binary files", () => {
    const root = plantTree({
      "skills/a/SKILL.md": "clean",
      "skills/a/notes.md": "see 192.168.0.9",
      "node_modules/pkg/readme.md": "see 192.168.0.9",
      ".git/config": "url = ssh://nas.local/repo",
      "cover.png": Buffer.concat([Buffer.from([0x89, 0x50, 0x00]), Buffer.from("192.168.0.9")]),
    });
    const { findings, missing } = scanPaths([root], []);
    expect(missing).toEqual([]);
    expect(findings.map((finding) => [path.relative(root, finding.file).split(path.sep).join("/"), finding.rule])).toEqual([
      ["skills/a/notes.md", "private-ip"],
    ]);
  });

  it("reports paths that do not exist", () => {
    const absent = path.join(scratchDir(), "absent");
    expect(scanPaths([absent], []).missing).toEqual([absent]);
  });
});

describe("zks scrub-check", { timeout: SUBPROCESS_TIMEOUT_MS }, () => {
  it("exits 1 on a planted client name from the private deny list", () => {
    const tree = plantTree({ "skills/x/SKILL.md": `Ported from the ${PLANTED_CLIENT} edit.` });
    const outcome = runScrubCheckCaptured([tree]);
    expect(outcome.status, outcome.stderr).toBe(1);
    expect(outcome.stdout).toMatch(/SKILL\.md:1:\d+\s+client-name/);
  });

  it("exits 1 on a plugin.json that declares hooks", () => {
    const tree = plantTree({ ".claude-plugin/plugin.json": JSON.stringify({ name: "p", hooks: { PreToolUse: [] } }) });
    const outcome = runScrubCheckCaptured([tree]);
    expect(outcome.status, outcome.stderr).toBe(1);
    expect(outcome.stdout).toMatch(/plugin\.json:\d+:\d+\s+plugin-hooks/);
  });

  it("exits 1 on a planted hooks.json, .mcp.json and skill frontmatter", () => {
    const tree = plantTree({
      "hooks/hooks.json": JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "touch x" }] }] } }),
      ".mcp.json": JSON.stringify({ mcpServers: { x: { command: "node" } } }),
      "skills/s/SKILL.md": skillWithFrontmatter("hooks:\n  Stop: []\nallowed-tools: Bash(*)"),
    });
    const outcome = runScrubCheckCaptured([tree]);
    expect(outcome.status, outcome.stderr).toBe(1);
    for (const rule of ["plugin-hooks", "plugin-mcp-servers", "skill-hooks", "skill-allowed-tools"]) expect(outcome.stdout).toContain(rule);
  });

  it("exits 2 when the deny list is missing or empty, unless --no-denylist is passed", () => {
    const tree = plantTree({ "skills/x/SKILL.md": "clean" });
    for (const home of [scratchDir(), plantTree({ [DENY_LIST_FILE]: "# no clients yet\n" })]) {
      const outcome = runScrubCheckCaptured([tree], home);
      expect(outcome.status).toBe(2);
      expect(outcome.stderr).toMatch(/deny list/);
    }
    const optedOut = runScrubCheckCaptured(["--no-denylist", tree], scratchDir());
    expect(optedOut.status, optedOut.stderr).toBe(0);
    expect(optedOut.stderr).toMatch(/client names not checked/);
  });

  it("exits 0 on the shipped tree", () => {
    const shipped = ["plugin", "examples", "themes"].filter((dir) => existsSync(path.join(REPO_ROOT, dir)));
    const outcome = spawnSync(process.execPath, [MAIN, "scrub-check", ...shipped], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: { ...process.env, ZKS_HOME: seededHome() },
    });
    expect(outcome.status, outcome.stdout + outcome.stderr).toBe(0);
  });

  it("exits 2 when any named path is missing, and with usage when given none or an unknown flag", () => {
    const present = plantTree({ "a.md": "clean" });
    const missing = runScrubCheckCaptured([present, path.join(scratchDir(), "absent")]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/absent not found/);
    expect(runScrubCheckCaptured([]).status).toBe(2);
    expect(runScrubCheckCaptured(["--no-denylist"]).status).toBe(2);
    expect(runScrubCheckCaptured(["--nope", present]).status).toBe(2);
  });
});
