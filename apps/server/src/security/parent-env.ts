// Created by The Angelo Umali.
// What a child process may inherit from the server: an allowlist, not a denylist, because the server's env carries
// Claude, cloud and database credentials (plan §11).

const OS_BASICS = ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TMP", "TEMP", "TMPDIR", "SystemRoot", "ComSpec", "PATHEXT", "LANG"];
const PROXY_VARS = ["HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS"];
// Named, not matched by prefix: any LC_<anything> reached children, so LC_ANTHROPIC_API_KEY would leak.
const LOCALE_VARS = ["LC_ALL", "LC_CTYPE", "LC_MESSAGES", "LC_COLLATE", "LC_NUMERIC", "LC_TIME", "LC_MONETARY"];

export interface ParentEnvOptions {
  readonly proxyOptIn: boolean;
  /** Names this child inherits beyond the OS basics and the locale. */
  readonly extraNames?: readonly string[];
  /** Defaults to process.env; injectable so tests can hand in a hostile parent. */
  readonly parentEnv?: Readonly<Record<string, string | undefined>> | undefined;
}

export function inheritedParentEnv(options: ParentEnvOptions): Record<string, string> {
  const parentEnv = options.parentEnv ?? process.env;
  const names = [...OS_BASICS, ...LOCALE_VARS, ...(options.extraNames ?? []), ...(options.proxyOptIn ? PROXY_VARS : [])];
  return pickDefined(names, parentEnv);
}

export function pickDefined(names: readonly string[], source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(names.flatMap((name) => (source[name] ? [[name, source[name]]] : [])));
}
