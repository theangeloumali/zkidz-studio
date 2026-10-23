// Created by The Angelo Umali.
// What a child process may inherit from the server: an allowlist, not a denylist, because the server's env carries
// Claude, cloud and database credentials (plan §11).

const OS_BASICS = ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TMP", "TEMP", "TMPDIR", "SystemRoot", "ComSpec", "PATHEXT", "LANG"];
const PROXY_VARS = ["HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS"];

export interface ParentEnvOptions {
  readonly proxyOptIn: boolean;
  /** Names this child inherits beyond the OS basics and the LC_* locale. */
  readonly extraNames?: readonly string[];
  /** Defaults to process.env; injectable so tests can hand in a hostile parent. */
  readonly parentEnv?: Readonly<Record<string, string | undefined>> | undefined;
}

export function inheritedParentEnv(options: ParentEnvOptions): Record<string, string> {
  const parentEnv = options.parentEnv ?? process.env;
  const localeNames = Object.keys(parentEnv).filter((name) => name.startsWith("LC_"));
  const names = [...OS_BASICS, ...localeNames, ...(options.extraNames ?? []), ...(options.proxyOptIn ? PROXY_VARS : [])];
  return pickDefined(names, parentEnv);
}

export function pickDefined(names: readonly string[], source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(names.flatMap((name) => (source[name] ? [[name, source[name]]] : [])));
}
