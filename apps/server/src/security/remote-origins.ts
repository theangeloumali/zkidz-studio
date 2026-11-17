// Created by The Angelo Umali.
// Remote mode: the https origins a TLS proxy publishes for the app and the preview. Off unless both env vars are set.
import { ENV } from "@zks/shared";

export interface RemoteOrigins {
  readonly appOrigin: string;
  readonly previewOrigin: string;
  readonly proxySecret: string;
}

export const MIN_PROXY_SECRET_LENGTH = 32;

type Environment = Readonly<Record<string, string | undefined>>;

/** The Host header a browser sends for this origin. */
export function hostOfOrigin(origin: string): string {
  return new URL(origin).host;
}

export function parseRemoteOrigins(env: Environment): RemoteOrigins | undefined {
  const rawApp = env[ENV.publicOrigin] ?? "";
  const rawPreview = env[ENV.previewPublicOrigin] ?? "";
  if (rawApp === "" && rawPreview === "") return undefined;
  if (rawApp === "") throw new Error(`${ENV.previewPublicOrigin} is set without ${ENV.publicOrigin}: set both or neither`);
  if (rawPreview === "") throw new Error(`${ENV.publicOrigin} is set without ${ENV.previewPublicOrigin}: set both or neither`);
  const appOrigin = parseHttpsOrigin(ENV.publicOrigin, rawApp);
  const previewOrigin = parseHttpsOrigin(ENV.previewPublicOrigin, rawPreview);
  if (appOrigin === previewOrigin) throw new Error(`${ENV.previewPublicOrigin} must differ from ${ENV.publicOrigin}: the preview is a separate origin`);
  const proxySecret = env[ENV.proxySecret] ?? "";
  if (proxySecret.length < MIN_PROXY_SECRET_LENGTH) {
    throw new Error(`${ENV.proxySecret} must be at least ${MIN_PROXY_SECRET_LENGTH} characters when remote mode is on`);
  }
  return { appOrigin, previewOrigin, proxySecret };
}

/** Only a bare `https://host[:port]`, so a path, query, hash or credentials cannot widen what the guards trust. */
function parseHttpsOrigin(envName: string, rawOrigin: string): string {
  const origin = URL.canParse(rawOrigin) ? new URL(rawOrigin).origin : "";
  if (!origin.startsWith("https://") || rawOrigin.toLowerCase().replace(/\/$/, "") !== origin) {
    throw new Error(`${envName} must be an https origin with no path, query or credentials, got "${rawOrigin}"`);
  }
  return origin;
}
