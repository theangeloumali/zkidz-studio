// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { buildMatrixLegs } from "../db-test-matrix.mjs";

const STACK_URL = "postgresql://postgres:<per-install>@127.0.0.1:45322/postgres";

describe("buildMatrixLegs", () => {
  it("runs PGlite first with DATABASE_URL removed, then the local Supabase stack's URL", () => {
    const legs = buildMatrixLegs({ PATH: "/bin", DATABASE_URL: "postgresql://stray" }, () => STACK_URL);

    expect(legs.map((leg) => leg.label)).toEqual(["pglite", "postgres"]);
    expect(legs[0]?.env).toEqual({ PATH: "/bin" });
    expect(legs[1]?.env).toEqual({ PATH: "/bin", DATABASE_URL: STACK_URL });
  });

  it("honours ZKS_TEST_DATABASE_URL without asking the stack", () => {
    const override = "postgresql://postgres:<other>@127.0.0.1:6543/postgres";
    const legs = buildMatrixLegs({ ZKS_TEST_DATABASE_URL: override }, () => {
      throw new Error("stack must not be queried");
    });

    expect(legs[1]?.env.DATABASE_URL).toBe(override);
  });
});
