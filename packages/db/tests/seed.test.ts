// Created by The Angelo Umali.
// The seed is what `db:reset` leaves behind: one sample project, safe to run twice.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, SAMPLE_PROJECT_SLUG, seedDatabase, type StudioDatabaseHandle } from "../src/index.ts";
import { projects } from "../schema.ts";

let dataDir: string;
let handle: StudioDatabaseHandle;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "zks-seed-"));
  handle = await openDatabase({ dataDir });
  await handle.migrate();
}, 120_000);

afterAll(async () => {
  await handle?.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("seedDatabase", () => {
  it("inserts the sample project once, even when run twice", async () => {
    await seedDatabase(handle.db);
    await seedDatabase(handle.db);

    const slugs = await handle.db.select({ slug: projects.slug }).from(projects);
    expect(slugs).toEqual([{ slug: SAMPLE_PROJECT_SLUG }]);
  });
});
