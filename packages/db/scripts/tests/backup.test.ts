// Created by The Angelo Umali.
// Backup, restore, reset and rollback on the backend DATABASE_URL selects (plan §8), always in a throwaway database.
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { agentSessions, events, projects, rules } from "../../schema.ts";
import { MIGRATIONS_FOLDER, openDatabase, SAMPLE_PROJECT_SLUG, type StudioDatabaseHandle } from "../../src/index.ts";
import { appliedMigrationCount, dumpStudioData, parseBackupArgs, resetDatabase, restoreStudioData, writeBackup } from "../backup.ts";

const databaseUrl = process.env.DATABASE_URL;
const TEST_TIMEOUT_MS = 120_000;
const cleanups: (() => Promise<void>)[] = [];

async function scratchDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zks-backup-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// A fresh database per test: a DATABASE_URL that points at real data is never written to.
async function openScratchDatabase(): Promise<StudioDatabaseHandle> {
  const dataDir = join(await scratchDir(), "db");
  if (!databaseUrl) return trackClose(await openDatabase({ dataDir }));
  const serverClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const scratchName = `zks_test_${randomUUID().replaceAll("-", "")}`;
  await serverClient.unsafe(`create database ${scratchName}`);
  cleanups.push(async () => {
    await serverClient.unsafe(`drop database if exists ${scratchName} with (force)`);
    await serverClient.end();
  });
  const scratchUrl = new URL(databaseUrl);
  scratchUrl.pathname = `/${scratchName}`;
  return trackClose(await openDatabase({ dataDir, databaseUrl: scratchUrl.href }));
}

function trackClose(handle: StudioDatabaseHandle): StudioDatabaseHandle {
  cleanups.unshift(() => handle.close());
  return handle;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function seedLinkedRows(handle: StudioDatabaseHandle): Promise<{ projectId: string; sessionId: string }> {
  const [project] = await handle.db.insert(projects).values({ slug: "trip", title: "Trip" }).returning({ id: projects.id });
  if (!project) throw new Error("project insert returned nothing");
  const [session] = await handle.db
    .insert(agentSessions)
    .values({ projectId: project.id, authMode: "api_key", usage: { inputTokens: 12, nested: { quote: "it's \\ fine\n" } } })
    .returning({ id: agentSessions.id });
  if (!session) throw new Error("session insert returned nothing");
  // projects ↔ agent_sessions reference each other, so a plain table-order restore cannot load them.
  await handle.db.update(projects).set({ currentSessionId: session.id }).where(eq(projects.id, project.id));
  await handle.db.insert(events).values([
    { projectId: project.id, sessionId: session.id, type: "agent.text", payload: { text: "one" } },
    { projectId: project.id, type: "agent.text", payload: { text: "two" } },
  ]);
  await handle.db.insert(rules).values({ text: "Never blur family", sourceQuote: "don't blur my kids" });
  return { projectId: project.id, sessionId: session.id };
}

async function snapshot(handle: StudioDatabaseHandle) {
  return {
    projects: await handle.db.select().from(projects).orderBy(projects.slug),
    sessions: await handle.db.select().from(agentSessions).orderBy(agentSessions.id),
    events: await handle.db.select().from(events).orderBy(events.id),
    rules: await handle.db.select().from(rules).orderBy(rules.id),
  };
}

describe(`backup and restore on ${databaseUrl ? "postgres" : "pglite"}`, () => {
  it(
    "restores every row, including a reference cycle, jsonb and identity ids",
    async () => {
      const source = await openScratchDatabase();
      await source.migrate();
      await seedLinkedRows(source);
      const before = await snapshot(source);
      const backupText = await dumpStudioData(source);

      const target = await openScratchDatabase();
      await target.migrate();
      await target.db.insert(projects).values({ slug: "overwritten", title: "Replaced by the restore" });
      await restoreStudioData(target, backupText);

      expect(await snapshot(target)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps identity sequences ahead of the restored ids",
    async () => {
      const source = await openScratchDatabase();
      await source.migrate();
      const { projectId } = await seedLinkedRows(source);
      const backupText = await dumpStudioData(source);

      const target = await openScratchDatabase();
      await restoreStudioData(target, backupText);
      const [nextEvent] = await target.db.insert(events).values({ projectId, type: "agent.text", payload: {} }).returning({ id: events.id });
      const maxRestoredId = Math.max(...(await snapshot(source)).events.map((event) => event.id));

      expect(nextEvent?.id).toBeGreaterThan(maxRestoredId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "records the migration level it was taken at",
    async () => {
      const handle = await openScratchDatabase();
      await handle.migrate();
      const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });

      expect(await appliedMigrationCount(handle)).toBe(migrations.length);
      expect(await dumpStudioData(handle)).toContain(`-- migrations: ${migrations.length} ${migrations.at(-1)?.hash}\n`);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a backup from another migration history or a newer release, before touching data",
    async () => {
      const handle = await openScratchDatabase();
      await handle.migrate();
      await seedLinkedRows(handle);
      const backupText = await dumpStudioData(handle);
      const before = await snapshot(handle);

      await expect(restoreStudioData(handle, backupText.replace(/^-- migrations: (\d+) \w+$/m, "-- migrations: $1 deadbeef"))).rejects.toThrow(
        /migration history/,
      );
      await expect(restoreStudioData(handle, backupText.replace(/^-- migrations: \d+/m, "-- migrations: 999"))).rejects.toThrow(/newer/);
      await expect(restoreStudioData(handle, "select 1;\n")).rejects.toThrow(/not a zkidz-studio backup/);
      expect(await snapshot(handle)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "writes the backup owner-only under the backups folder",
    async () => {
      const handle = await openScratchDatabase();
      await handle.migrate();
      await seedLinkedRows(handle);
      const backupsDir = join(await scratchDir(), "backups");

      const backupPath = await writeBackup(handle, backupsDir);

      expect(backupPath).toMatch(/[/\\]studio-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql$/);
      expect(await readFile(backupPath, "utf8")).toBe(await dumpStudioData(handle));
      if (process.platform !== "win32") expect((await stat(backupPath)).mode & 0o777).toBe(0o600);
    },
    TEST_TIMEOUT_MS,
  );
});

describe(`reset on ${databaseUrl ? "postgres" : "pglite"}`, () => {
  it(
    "drops every row and leaves the migrated schema with only the sample project",
    async () => {
      const handle = await openScratchDatabase();
      await handle.migrate();
      await seedLinkedRows(handle);

      await resetDatabase(handle);

      const remaining = await snapshot(handle);
      expect(remaining.projects.map((project) => project.slug)).toEqual([SAMPLE_PROJECT_SLUG]);
      expect(remaining.events).toEqual([]);
      expect(remaining.rules).toEqual([]);
      const [identity] = await handle.rows(sql`select count(*)::int as applied from drizzle.__drizzle_migrations`);
      expect(identity?.applied).toBe(readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("parseBackupArgs", () => {
  it("reads each command's arguments", () => {
    expect(parseBackupArgs(["backup"])).toEqual({ command: "backup" });
    expect(parseBackupArgs(["reset"])).toEqual({ command: "reset" });
    expect(parseBackupArgs(["restore", "/backups/studio-1.sql"])).toEqual({ command: "restore", backupFile: "/backups/studio-1.sql" });
    expect(parseBackupArgs(["rollback", "--to", "0000"])).toEqual({ command: "rollback", keepThrough: 0 });
    expect(parseBackupArgs(["rollback", "--", "--to", "0012"])).toEqual({ command: "rollback", keepThrough: 12 });
  });

  it.each([[[]], [["restore"]], [["rollback"]], [["rollback", "--to", "12"]], [["drop"]]])("rejects %j with a usage line", (argv) => {
    expect(() => parseBackupArgs(argv)).toThrow(/usage/i);
  });
});
