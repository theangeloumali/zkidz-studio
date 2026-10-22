// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { SUPABASE_DB_PORT } from "@zks/shared";
import { DEFAULT_SUPABASE_TEST_URL, buildMatrixLegs } from "../db-test-matrix.mjs";

describe("buildMatrixLegs", () => {
  it("runs PGlite first with DATABASE_URL removed, then Postgres", () => {
    const legs = buildMatrixLegs({ PATH: "/bin", DATABASE_URL: "postgresql://stray" });

    expect(legs.map((leg) => leg.label)).toEqual(["pglite", "postgres"]);
    expect(legs[0]?.env).toEqual({ PATH: "/bin" });
    expect(legs[1]?.env).toEqual({ PATH: "/bin", DATABASE_URL: DEFAULT_SUPABASE_TEST_URL });
  });

  it("targets the loopback Supabase port by default and honours an override", () => {
    expect(DEFAULT_SUPABASE_TEST_URL).toBe("postgresql://postgres:postgres@127.0.0.1:45322/postgres");
    expect(SUPABASE_DB_PORT).toBe(45322);

    const legs = buildMatrixLegs({ ZKS_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:6543/postgres" });

    expect(legs[1]?.env.DATABASE_URL).toBe("postgresql://postgres:postgres@127.0.0.1:6543/postgres");
  });
});
