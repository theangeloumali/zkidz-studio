// Created by The Angelo Umali.
// The real client (plan §8): PGlite on disk under a process lock when DATABASE_URL is unset.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseLockedError, openDatabase, selectBackend } from "../src/index.ts";
import { projects } from "../schema.ts";

const scratchDirs: string[] = [];

async function scratchDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zks-db-"));
  scratchDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("selectBackend", () => {
  it("picks PGlite when DATABASE_URL is unset or empty", () => {
    expect(selectBackend(undefined)).toBe("pglite");
    expect(selectBackend("")).toBe("pglite");
  });

  it("picks postgres.js for postgres:// and postgresql:// URLs", () => {
    expect(selectBackend("postgres://127.0.0.1:45322/postgres")).toBe("postgres");
    expect(selectBackend("postgresql://127.0.0.1:45322/postgres")).toBe("postgres");
  });

  it("rejects any other scheme instead of guessing", () => {
    expect(() => selectBackend("mysql://127.0.0.1/db")).toThrow(/postgres:\/\//);
  });
});

describe("openDatabase on PGlite", () => {
  it("migrates, writes and reads back after a reopen", async () => {
    const dataDir = await scratchDir();
    const first = await openDatabase({ dataDir });
    await first.migrate();
    await first.db.insert(projects).values({ slug: "first-cut", title: "First cut" });
    await first.close();

    const second = await openDatabase({ dataDir });
    await second.migrate();
    const rows = await second.db.select({ slug: projects.slug }).from(projects);
    await second.close();

    expect(second.backend).toBe("pglite");
    expect(rows).toEqual([{ slug: "first-cut" }]);
  }, 120_000);

  it("refuses a second open of the same data dir while the first is live", async () => {
    const dataDir = await scratchDir();
    const holder = await openDatabase({ dataDir });
    try {
      await expect(openDatabase({ dataDir })).rejects.toBeInstanceOf(DatabaseLockedError);
    } finally {
      await holder.close();
    }
    const reopened = await openDatabase({ dataDir });
    const [row] = await reopened.rows(sql`select 1 as one`);
    await reopened.close();
    expect(row).toEqual({ one: 1 });
  }, 120_000);
});
