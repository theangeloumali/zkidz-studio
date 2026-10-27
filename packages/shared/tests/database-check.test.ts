// Created by The Angelo Umali.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkDatabase } from "../src/database-check.ts";
import { SUPABASE_DB_PORT } from "../src/runtime.ts";

// Built at runtime: a literal would read as a leaked credential to gitleaks.
const GENERATED_PASSWORD = randomBytes(12).toString("hex");
const LOOPBACK_URL = `postgresql://postgres:${GENERATED_PASSWORD}@127.0.0.1:${SUPABASE_DB_PORT}/postgres`;

function probeAnswering(addresses: string[]) {
  const probedPorts: number[] = [];
  return {
    probedPorts,
    findExposedAddresses: (port: number) => {
      probedPorts.push(port);
      return Promise.resolve(addresses);
    },
  };
}

describe("checkDatabase", () => {
  it("names the embedded database when DATABASE_URL is unset", async () => {
    const probe = probeAnswering([]);
    const result = await checkDatabase({ databaseUrl: undefined, ...probe });

    expect(result).toMatchObject({ id: "database", status: "ok", required: true });
    expect(result.detail).toBe("Embedded database (PGlite)");
    expect(probe.probedPorts).toEqual([SUPABASE_DB_PORT]);
  });

  it("fails when the Postgres port answers on a non-loopback address, even with PGlite selected", async () => {
    const result = await checkDatabase({ databaseUrl: undefined, ...probeAnswering(["192.0.2.10"]) });

    expect(result).toMatchObject({ status: "fail", required: true });
    expect(result.detail).toContain("192.0.2.10");
    expect(result.fix).toContain("127.0.0.1");
  });

  it("probes the port named in DATABASE_URL", async () => {
    const probe = probeAnswering([]);
    await checkDatabase({ databaseUrl: LOOPBACK_URL.replace(String(SUPABASE_DB_PORT), "55432"), ...probe });

    expect(probe.probedPorts).toEqual([55432]);
  });

  it("accepts a loopback Postgres URL with a generated password and never prints the password", async () => {
    const result = await checkDatabase({ databaseUrl: LOOPBACK_URL, ...probeAnswering([]) });

    expect(result.status).toBe("ok");
    expect(result.detail).toContain(`127.0.0.1:${SUPABASE_DB_PORT}`);
    expect(JSON.stringify(result)).not.toContain(GENERATED_PASSWORD);
  });

  it("fails a Postgres URL on a non-loopback host", async () => {
    const result = await checkDatabase({ databaseUrl: LOOPBACK_URL.replace("127.0.0.1", "db.example.com"), ...probeAnswering([]) });

    expect(result.status).toBe("fail");
    expect(JSON.stringify(result)).not.toContain(GENERATED_PASSWORD);
  });

  // An unencoded @ and / in a password moves part of it into the host the URL parser reports.
  it("fails a URL with more than one @ without naming any part of it as a host", async () => {
    const head = ["a", "b"].join("");
    const tail = ["def", "ghi"].join("");
    const result = await checkDatabase({ databaseUrl: `postgresql://postgres:${head}@c/${tail}@127.0.0.1:45322/postgres`, ...probeAnswering([]) });

    expect(result.status).toBe("fail");
    expect(result.detail).not.toMatch(/points at/);
    expect(JSON.stringify(result)).not.toMatch(/ab@c|defghi/);
    expect(result.fix).toContain("db:supabase:url");
  });

  it("fails its own row when the exposure probe throws, instead of failing the whole doctor", async () => {
    const result = await checkDatabase({
      databaseUrl: undefined,
      findExposedAddresses: () => Promise.reject(new Error("uv_interface_addresses returned Unknown system error 1")),
    });

    expect(result).toMatchObject({ id: "database", status: "fail" });
    expect(result.detail).toContain("could not check");
    expect(result.detail).toContain("uv_interface_addresses");
  });

  it("fails Supabase's default postgres password", async () => {
    const result = await checkDatabase({ databaseUrl: "postgres://postgres:postgres@127.0.0.1:45322/postgres", ...probeAnswering([]) });

    expect(result.status).toBe("fail");
    expect(result.fix).toContain("db:supabase:url");
  });

  it.each(["mysql://root@127.0.0.1/app", "not a url"])("fails an unsupported DATABASE_URL %s", async (databaseUrl) => {
    const result = await checkDatabase({ databaseUrl, ...probeAnswering([]) });

    expect(result.status).toBe("fail");
  });
});
