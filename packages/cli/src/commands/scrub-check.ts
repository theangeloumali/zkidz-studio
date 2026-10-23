// Created by The Angelo Umali.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Lives in ZKS_HOME, never in the repo: the list of client names is itself the secret. */
export const DENY_LIST_FILE = "scrub-denylist.txt";

export type ScrubRule =
  | "client-name"
  | "email"
  | "hostname"
  | "private-ip"
  | "personal-path"
  | "plugin-hooks"
  | "plugin-mcp-servers"
  | "plugin-lsp-servers"
  | "plugin-invalid-json"
  | "skill-hooks"
  | "skill-allowed-tools"
  | "prompt-script";

export interface ScrubFinding {
  file: string;
  line: number;
  column: number;
  rule: ScrubRule;
  match: string;
}

interface LinePattern {
  rule: ScrubRule;
  pattern: RegExp;
  isAllowed?: (match: RegExpExecArray) => boolean;
}

const USAGE = "usage: zks scrub-check [--no-denylist] <path>...";
const NO_DENY_LIST_FLAG = "--no-denylist";
const EXIT_USAGE = 2;
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist"]);
const RESERVED_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$/i;
// Doc placeholders and OS-shared accounts, not a person.
const PLACEHOLDER_USERS = new Set(["user", "username", "you", "yourname", "your-name", "name", "shared", "public", "default", "runner"]);
const PLUGIN_FORBIDDEN_KEYS: readonly [string, ScrubRule][] = [
  ["hooks", "plugin-hooks"],
  ["mcpServers", "plugin-mcp-servers"],
  ["lspServers", "plugin-lsp-servers"],
];
// Claude Code loads these beside plugin.json, so each one runs code on the user's machine whatever it contains.
const PLUGIN_CONFIG_FILES: readonly [(file: string) => boolean, ScrubRule][] = [
  [(file) => path.basename(file) === "hooks.json" && path.basename(path.dirname(file)) === "hooks", "plugin-hooks"],
  [(file) => path.basename(file) === ".mcp.json", "plugin-mcp-servers"],
  [(file) => path.basename(file) === ".lsp.json", "plugin-lsp-servers"],
];
const FRONTMATTER_DIRS = new Set(["agents", "commands"]);
// Shell, file-write and web tools; read-only tools and the studio's own MCP tools stay allowed.
const GRANTED_TOOL_PATTERN = /\b(?:Bash|Edit|MultiEdit|Write|NotebookEdit|Web[A-Za-z]*)\b/;

const GENERIC_PATTERNS: readonly LinePattern[] = [
  {
    rule: "email",
    pattern: /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g,
    isAllowed: (match) => RESERVED_EMAIL_DOMAIN.test(match[1] ?? ""),
  },
  // The lookarounds keep file names like .env.local and settings.local.json out.
  {
    rule: "hostname",
    pattern: /(?<![\w.-])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:local|lan|internal|intranet|corp|home\.arpa|ts\.net)(?![\w-]|\.[a-z])/gi,
  },
  // The lookarounds keep dotted version strings (1.10.0.5.2) out.
  { rule: "private-ip", pattern: /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?!\d|\.\d)/g, isAllowed: (match) => !isPrivateIpv4(match[0]) },
  {
    rule: "personal-path",
    pattern: /(?:\/mnt\/[a-z]\/Users\/|\/home\/|\/Users\/|\b[a-z]:(?:\\+|\/)Users(?:\\+|\/))([^\s/\\"'`<>$%{}()[\]*]+)/gi,
    isAllowed: (match) => PLACEHOLDER_USERS.has((match[1] ?? "").toLowerCase()),
  },
];
const PROMPT_PATTERN: LinePattern = { rule: "prompt-script", pattern: /<script|\beval\b/gi };

export function scanText(file: string, text: string, denyTerms: readonly string[]): ScrubFinding[] {
  const patterns = [...denyTerms.map(denyTermPattern), ...GENERIC_PATTERNS];
  if (isUnderPrompts(file)) patterns.push(PROMPT_PATTERN);
  const lineFindings = text.split(/\r?\n/).flatMap((lineText, index) => scanLine(lineText, patterns).map((hit) => ({ file, line: index + 1, ...hit })));
  const configFindings = PLUGIN_CONFIG_FILES.filter(([matches]) => matches(file)).map(([, rule]) => ({
    file,
    line: 1,
    column: 1,
    rule,
    match: path.basename(file),
  }));
  const manifestFindings = path.basename(file) === "plugin.json" ? scanPluginManifest(file, text) : [];
  const frontmatterFindings = hasCapabilityFrontmatter(file) ? scanFrontmatter(file, text) : [];
  return [...lineFindings, ...configFindings, ...manifestFindings, ...frontmatterFindings];
}

export function loadDenyTerms(zksHome: string): string[] {
  const denyListPath = path.join(zksHome, DENY_LIST_FILE);
  if (!existsSync(denyListPath)) return [];
  return readFileSync(denyListPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function scanPaths(roots: readonly string[], denyTerms: readonly string[]): { findings: ScrubFinding[]; missing: string[] } {
  const missing = roots.filter((root) => !existsSync(root));
  const files = roots.filter((root) => existsSync(root)).flatMap(listFiles);
  const findings = files.flatMap((file) => {
    const content = readFileSync(file);
    return content.includes(0) ? [] : scanText(file, content.toString("utf8"), denyTerms);
  });
  return { findings, missing };
}

/** Exit 2 means the gate could not run as asked (bad args, a missing root, no deny list), never "clean". */
export function runScrubCheck(args: readonly string[], zksHome: string): number {
  const flags = args.filter((arg) => arg.startsWith("--"));
  const roots = args.filter((arg) => !arg.startsWith("--"));
  if (roots.length === 0 || flags.some((flag) => flag !== NO_DENY_LIST_FLAG)) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const missingRoots = roots.filter((root) => !existsSync(root));
  for (const root of missingRoots) console.error(`scrub-check: ${root} not found`);
  if (missingRoots.length > 0) return EXIT_USAGE;
  const denyTerms = loadDenyTerms(zksHome);
  if (denyTerms.length === 0) {
    if (!flags.includes(NO_DENY_LIST_FLAG)) {
      console.error(`scrub-check: no client names in the deny list at ${path.join(zksHome, DENY_LIST_FILE)}; seed it, or pass ${NO_DENY_LIST_FLAG}`);
      return EXIT_USAGE;
    }
    console.error("scrub-check: warning: client names not checked (--no-denylist)");
  }
  const { findings } = scanPaths(roots, denyTerms);
  for (const finding of findings) console.log(formatFinding(finding));
  console.error(`scrub-check: ${findings.length} finding(s)`);
  return findings.length > 0 ? 1 : 0;
}

function formatFinding({ file, line, column, rule, match }: ScrubFinding): string {
  const displayPath = path.relative(process.cwd(), file).split(path.sep).join("/") || file;
  return `${displayPath}:${line}:${column}  ${rule}  ${match}`;
}

function denyTermPattern(term: string): LinePattern {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { rule: "client-name", pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu") };
}

function scanLine(lineText: string, patterns: readonly LinePattern[]): Omit<ScrubFinding, "file" | "line">[] {
  return patterns.flatMap(({ rule, pattern, isAllowed }) =>
    [...lineText.matchAll(pattern)].filter((match) => !isAllowed?.(match)).map((match) => ({ column: match.index + 1, rule, match: match[0] })),
  );
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first = 0, second = 0] = octets;
  if (octets.some((octet) => octet > 255)) return false;
  // 100.64/10 is carrier-grade NAT, which is where Tailscale hands out addresses.
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

function isUnderPrompts(file: string): boolean {
  return file.split(/[\\/]/).slice(0, -1).includes("prompts");
}

/** A plugin that declares hooks or MCP servers runs code on the user's machine, which bundled skills must never do. */
function scanPluginManifest(file: string, text: string): ScrubFinding[] {
  const manifest = parseJsonObject(text);
  if (!manifest) return [{ file, line: 1, column: 1, rule: "plugin-invalid-json", match: text.slice(0, 40) }];
  return PLUGIN_FORBIDDEN_KEYS.filter(([key]) => Object.hasOwn(manifest, key)).map(([key, rule]) => ({
    file,
    ...positionOf(text, `"${key}"`),
    rule,
    match: key,
  }));
}

function hasCapabilityFrontmatter(file: string): boolean {
  return path.basename(file) === "SKILL.md" || (file.endsWith(".md") && FRONTMATTER_DIRS.has(path.basename(path.dirname(file))));
}

/** Skills, agents and commands can register hooks or pre-approve tools in their frontmatter, bypassing the user's prompts. */
function scanFrontmatter(file: string, text: string): ScrubFinding[] {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  const closingIndex = lines.findIndex((lineText, index) => index > 0 && lineText.trim() === "---");
  const frontmatterLines = lines.slice(1, closingIndex < 0 ? lines.length : closingIndex);
  return topLevelEntries(frontmatterLines).flatMap(({ key, value, lineIndex }): ScrubFinding[] => {
    const position = { file, line: lineIndex + 2, column: 1 };
    if (key === "hooks") return [{ ...position, rule: "skill-hooks", match: key }];
    const grantedTool = key === "allowed-tools" ? GRANTED_TOOL_PATTERN.exec(value) : null;
    return grantedTool ? [{ ...position, rule: "skill-allowed-tools", match: grantedTool[0] }] : [];
  });
}

/** Each unindented `key:` with its inline value plus any indented or list lines under it. */
function topLevelEntries(frontmatterLines: readonly string[]): { key: string; value: string; lineIndex: number }[] {
  const entries: { key: string; value: string; lineIndex: number }[] = [];
  frontmatterLines.forEach((lineText, lineIndex) => {
    const keyMatch = /^([A-Za-z][\w-]*)\s*:(.*)$/.exec(lineText);
    const currentEntry = entries.at(-1);
    if (keyMatch) entries.push({ key: keyMatch[1] ?? "", value: keyMatch[2] ?? "", lineIndex });
    else if (currentEntry) currentEntry.value += `\n${lineText}`;
  });
  return entries;
}

function parseJsonObject(text: string): object | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    // An unparseable manifest is reported as a finding, not thrown.
    return undefined;
  }
}

function positionOf(text: string, needle: string): { line: number; column: number } {
  const before = text.slice(0, Math.max(text.indexOf(needle), 0)).split(/\r?\n/);
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}

function listFiles(root: string): string[] {
  if (!statSync(root).isDirectory()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : listFiles(entryPath);
    // Symlinks are skipped so a link cannot pull a scan outside the named tree.
    return entry.isFile() ? [entryPath] : [];
  });
}
