// Created by The Angelo Umali.
// The doctor's database row (plan §8): which backend DATABASE_URL selects, and that Postgres never answers off loopback.
import { findExposedAddresses as probeNonLoopback } from "./loopback-probe.ts";
import { ENV, LOOPBACK_HOST, LOOPBACK_LITERAL_HOSTS, SUPABASE_DB_PORT } from "./runtime.ts";

const POSTGRES_PROTOCOLS: ReadonlySet<string> = new Set(["postgres:", "postgresql:"]);
const DEFAULT_PASSWORD = "postgres";
const URL_FIX = "Use the generated loopback URL: DATABASE_URL=$(pnpm --silent db:supabase:url)";

/** A doctor row: the CLI prints it, and the server runs it itself since its doctor child never sees DATABASE_URL. */
export interface DatabaseCheck {
  readonly id: "database";
  readonly status: "ok" | "warn" | "fail";
  readonly required: true;
  readonly detail: string;
  readonly fix?: string;
}

export interface DatabaseCheckOptions {
  readonly databaseUrl: string | undefined;
  /** The non-loopback addresses on which `port` accepts a TCP connection. */
  readonly findExposedAddresses?: (port: number) => Promise<string[]>;
}

function databaseResult(status: DatabaseCheck["status"], detail: string, fix?: string): DatabaseCheck {
  return { id: "database", status, required: true, detail, ...(fix ? { fix } : {}) };
}

export async function checkDatabase({ databaseUrl, findExposedAddresses = probeNonLoopback }: DatabaseCheckOptions): Promise<DatabaseCheck> {
  if (!databaseUrl) return checkExposure(SUPABASE_DB_PORT, "Embedded database (PGlite)", findExposedAddresses);

  // A raw @ and / in a password would move part of it into the host the parser reports, and from there into this row.
  if (databaseUrl.split("@").length > 2)
    return databaseResult("fail", `${ENV.databaseUrl} has more than one @; percent-encode the password (@ is %40)`, URL_FIX);
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return databaseResult("fail", `${ENV.databaseUrl} is not a URL`, URL_FIX);
  }
  if (!POSTGRES_PROTOCOLS.has(url.protocol))
    return databaseResult("fail", `${ENV.databaseUrl} must be postgres:// or postgresql://, not ${url.protocol}//`, URL_FIX);
  // Checked before the host: Supabase's default password is the hole, wherever it points.
  if (decodeURIComponent(url.password) === DEFAULT_PASSWORD) return databaseResult("fail", `${ENV.databaseUrl} uses the default postgres password`, URL_FIX);
  if (!LOOPBACK_LITERAL_HOSTS.has(url.hostname)) {
    return databaseResult("fail", `${ENV.databaseUrl} points at ${url.hostname}; Postgres must be on loopback`, `Use ${LOOPBACK_HOST}. ${URL_FIX}`);
  }
  const port = url.port ? Number(url.port) : SUPABASE_DB_PORT;
  return checkExposure(port, `Postgres at ${url.hostname}:${port}`, findExposedAddresses);
}

async function checkExposure(port: number, backend: string, findExposedAddresses: (port: number) => Promise<string[]>): Promise<DatabaseCheck> {
  let exposed: string[];
  try {
    exposed = await findExposedAddresses(port);
  } catch (error) {
    // Its own fail row: a throw here would fail the CLI doctor's report, and with it every row on the Setup page.
    return databaseResult("fail", `${backend}, but could not check port ${port}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (exposed.length === 0) return databaseResult("ok", backend);
  return databaseResult(
    "fail",
    `${backend}, but port ${port} answers on ${exposed.join(", ")}`,
    `Publish Postgres on ${LOOPBACK_HOST}:${port} only (supabase/compose.yml), then restart it: pnpm db:supabase:stop && pnpm db:supabase:start`,
  );
}
