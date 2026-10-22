// Created by The Angelo Umali.
// `doctor --json` is meant to be pasted into public issues, so anything credential-shaped is masked before printing.

const MASK = "<redacted>";
const SECRET_KEY_PATTERN = /authorization|api[-_]?key|token|secret|password|cookie/i;
const TEXT_PATTERNS: readonly [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]+/g, `sk-ant-${MASK}`],
  [/\b(authorization|x-api-key)(["']?\s*[:=]\s*["']?)[^"'\n,}]+/gi, `$1$2${MASK}`],
  [/\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${MASK}`],
  [/(\/home\/|\/Users\/|[A-Za-z]:\\Users\\)[^/\\\s"']+/g, `$1<user>`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, `<email>`],
];

/** Directories whose names can identify the user; ZKS_HOME is replaced first because it usually sits inside the home dir. */
export interface PathRoots {
  zksHome?: string;
  homeDir?: string;
}

const MIN_ROOT_LENGTH = 2;

function maskPathRoots(text: string, { zksHome, homeDir }: PathRoots): string {
  const roots: [string | undefined, string][] = [
    [zksHome, "$ZKS_HOME"],
    [homeDir, "~"],
  ];
  return roots.reduce((masked, [root, placeholder]) => (root && root.length >= MIN_ROOT_LENGTH ? masked.split(root).join(placeholder) : masked), text);
}

export function redactText(text: string, roots: PathRoots = {}): string {
  return TEXT_PATTERNS.reduce((masked, [pattern, replacement]) => masked.replace(pattern, replacement), maskPathRoots(text, roots));
}

export function redactReport(value: unknown, roots: PathRoots = {}): unknown {
  if (typeof value === "string") return redactText(value, roots);
  if (Array.isArray(value)) return value.map((entry) => redactReport(entry, roots));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, SECRET_KEY_PATTERN.test(key) && typeof entry === "string" ? MASK : redactReport(entry, roots)]),
  );
}
