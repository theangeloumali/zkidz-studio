// Created by The Angelo Umali.
// The one redactor: server logs use redactSecrets; `zks doctor --json` (pasted into public issues) also masks user paths and identity.

const MASK = "[REDACTED]";
const SECRET_KEY_PATTERN = /authorization|api[-_]?key|token|secret|password|cookie/i;
// Header rules run before the bearer rule so a header line collapses to one mask.
const SECRET_PATTERNS: readonly [RegExp, string][] = [
  // scheme://user:password@ — the user and host stay, so a log still says which database it was.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${MASK}@`],
  [/sk-ant-[A-Za-z0-9_-]+/g, MASK],
  // The header or JSON key stays; its value (to the line end, or the closing quote) goes.
  [/((?:x-api-key|authorization)"?\s*[:=]\s*")[^"]*/gi, `$1${MASK}`],
  [/((?:x-api-key|authorization)\s*[:=]\s*)(?!")[^\r\n,}"]+/gi, `$1${MASK}`],
  [/\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${MASK}`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, MASK],
];
const USER_PATH_PATTERN = /(\/home\/|\/Users\/|[A-Za-z]:\\Users\\)[^/\\\s"']+/g;
const MIN_ROOT_LENGTH = 2;
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
// A trailing `-suffix` or fifth part marks a version (a WSL kernel is 6.18.33.2-microsoft), not an address.
const IPV4_PATTERN = new RegExp(`(?<![\\w.-])${OCTET}(?:\\.${OCTET}){3}(?![\\w-]|\\.\\d)`, "g");
// Values under these keys are versions by contract, so an IPv4-shaped one like "6.18.33.2" stays readable.
const VERSION_KEY_PATTERN = /^os$|version|release|kernel/i;
// Check ids and labels are written by us, so a username like the container's `node` must not mask them.
const AUTHORED_KEY_PATTERN = /^(id|label)$/;

/** Names that can identify the user. ZKS_HOME is replaced first because it usually sits inside the home dir. */
export interface PathRoots {
  zksHome?: string;
  homeDir?: string;
  hostName?: string;
  userName?: string;
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole names only, so a short username does not eat parts of ordinary words. */
function maskNames(text: string, { hostName, userName }: PathRoots): string {
  const names: [string | undefined, string][] = [
    [hostName, "<host>"],
    [userName, "<user>"],
  ];
  return names.reduce(
    (masked, [name, placeholder]) =>
      name && name.length >= MIN_ROOT_LENGTH ? masked.replace(new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, "gi"), placeholder) : masked,
    text,
  );
}

function redactString(text: string, roots: PathRoots, maskIps: boolean, maskIdentity = true): string {
  const pathsMasked = maskPathRoots(text, roots);
  const masked = redactSecrets(maskIdentity ? maskNames(pathsMasked, roots) : pathsMasked).replace(USER_PATH_PATTERN, "$1<user>");
  return maskIps ? masked.replace(IPV4_PATTERN, "<ip>") : masked;
}

export function redactText(text: string, roots: PathRoots = {}): string {
  return redactString(text, roots, true);
}

export function redactReport(value: unknown, roots: PathRoots = {}, key = ""): unknown {
  if (typeof value === "string") return redactString(value, roots, !VERSION_KEY_PATTERN.test(key), !AUTHORED_KEY_PATTERN.test(key));
  if (Array.isArray(value)) return value.map((entry) => redactReport(entry, roots, key));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entry]) => [
      entryKey,
      SECRET_KEY_PATTERN.test(entryKey) && typeof entry === "string" ? MASK : redactReport(entry, roots, entryKey),
    ]),
  );
}
