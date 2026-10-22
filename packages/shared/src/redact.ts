// Created by The Angelo Umali.
// The one redactor: server logs use redactSecrets; `zks doctor --json` (pasted into public issues) also masks user paths.

const MASK = "[REDACTED]";
const SECRET_KEY_PATTERN = /authorization|api[-_]?key|token|secret|password|cookie/i;
// Header rules run before the bearer rule so a header line collapses to one mask.
const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]+/g, MASK],
  // The header or JSON key stays; its value (to the line end, or the closing quote) goes.
  [/((?:x-api-key|authorization)"?\s*[:=]\s*")[^"]*/gi, `$1${MASK}`],
  [/((?:x-api-key|authorization)\s*[:=]\s*)(?!")[^\r\n,}"]+/gi, `$1${MASK}`],
  [/\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${MASK}`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, MASK],
];
const USER_PATH_PATTERN = /(\/home\/|\/Users\/|[A-Za-z]:\\Users\\)[^/\\\s"']+/g;
const MIN_ROOT_LENGTH = 2;

/** Directories whose names can identify the user; ZKS_HOME is replaced first because it usually sits inside the home dir. */
export interface PathRoots {
  zksHome?: string;
  homeDir?: string;
}

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((masked, [pattern, replacement]) => masked.replace(pattern, replacement), text);
}

function maskPathRoots(text: string, { zksHome, homeDir }: PathRoots): string {
  const roots: [string | undefined, string][] = [
    [zksHome, "$ZKS_HOME"],
    [homeDir, "~"],
  ];
  return roots.reduce((masked, [root, placeholder]) => (root && root.length >= MIN_ROOT_LENGTH ? masked.split(root).join(placeholder) : masked), text);
}

export function redactText(text: string, roots: PathRoots = {}): string {
  return redactSecrets(maskPathRoots(text, roots)).replace(USER_PATH_PATTERN, "$1<user>");
}

export function redactReport(value: unknown, roots: PathRoots = {}): unknown {
  if (typeof value === "string") return redactText(value, roots);
  if (Array.isArray(value)) return value.map((entry) => redactReport(entry, roots));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, SECRET_KEY_PATTERN.test(key) && typeof entry === "string" ? MASK : redactReport(entry, roots)]),
  );
}
