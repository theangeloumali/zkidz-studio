// Created by The Angelo Umali.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSpecLock } from "../../src/specs/spec-files.ts";
import { withCueSheetLock } from "../../src/tools/cue-sheets.ts";
import { writeAgentSpec } from "../../src/tools/spec-store.ts";
import { createTestServer, getRequest, insertProject, postJson, type TestServer } from "../support/test-server.ts";
import { createToolFixture, type ToolFixture } from "../tools/tool-fixtures.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

const CUES_ADDRESS = { videoId: "v1", kind: "cues" } as const;
const cueSheetVersion = (version: number) => ({ cues: [{ kind: "keyword", at: version, text: `version ${version}` }] });

async function fixtureWithFourVersions(): Promise<ToolFixture> {
  const fixture = await createToolFixture(server);
  for (const version of [1, 2, 3, 4]) await writeAgentSpec(fixture.context, CUES_ADDRESS, cueSheetVersion(version));
  return fixture;
}

function specsPath(fixture: ToolFixture, suffix = "") {
  return `/api/projects/${fixture.context.projectId}/specs${suffix}`;
}

describe("restoring a spec version", () => {
  it("rewrites the spec file with version 3 and emits spec.version", async () => {
    const fixture = await fixtureWithFourVersions();

    const response = await postJson(server, specsPath(fixture, "/v1/cues/restore"), { version: 3 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ videoId: "v1", kind: "cues", currentVersion: 5 });
    const specFile = await readFile(join(fixture.projectRoot, "work/cues/v1.json"), "utf8");
    expect(JSON.parse(specFile)).toEqual(cueSheetVersion(3));
    expect(fixture.events).toContainEqual(
      expect.objectContaining({ type: "spec.version", videoId: "v1", kind: "cues", version: 5, author: "user", note: "Restored version 3" }),
    );
  });

  it("snapshots the file it replaces under the work dir", async () => {
    const fixture = await fixtureWithFourVersions();

    await postJson(server, specsPath(fixture, "/v1/cues/restore"), { version: 2 });

    const snapshot = await readFile(join(fixture.projectRoot, "work/versions/cues/v1.v4.json"), "utf8");
    expect(JSON.parse(snapshot)).toEqual(cueSheetVersion(4));
  });

  it("leaves the file at the current version when restores run at once", async () => {
    const fixture = await fixtureWithFourVersions();

    await Promise.all([1, 2, 3, 1, 2, 3].map(async (version) => postJson(server, specsPath(fixture, "/v1/cues/restore"), { version })));

    const current = (await (await getRequest(server, specsPath(fixture, "/v1/cues"))).json()) as { version: number; content: unknown };
    expect(current.version).toBe(10);
    expect(JSON.parse(await readFile(join(fixture.projectRoot, "work/cues/v1.json"), "utf8"))).toEqual(current.content);
  });

  it("waits for a cue edit in progress, so the edit cannot overwrite the restored file", async () => {
    const fixture = await fixtureWithFourVersions();
    let finishCueEdit = () => {};
    const cueEdit = withCueSheetLock(fixture.context.projectId, () => new Promise<void>((resolve) => (finishCueEdit = resolve)));

    const restore = Promise.resolve(postJson(server, specsPath(fixture, "/v1/cues/restore"), { version: 2 }));
    const settledFirst = await Promise.race([restore.then(() => "restore"), new Promise((resolve) => setTimeout(resolve, 300, "cue edit"))]);
    finishCueEdit();
    await cueEdit;

    expect(settledFirst).toBe("cue edit");
    expect((await restore).status).toBe(200);
  });

  it("makes an agent write wait for a restore of the same spec in progress", async () => {
    const fixture = await fixtureWithFourVersions();
    let finishRestore = () => {};
    const restoreInProgress = withSpecLock(fixture.context.projectId, CUES_ADDRESS, () => new Promise<void>((resolve) => (finishRestore = resolve)));

    const agentWrite = writeAgentSpec(fixture.context, CUES_ADDRESS, cueSheetVersion(5));
    const settledFirst = await Promise.race([agentWrite.then(() => "agent write"), new Promise((resolve) => setTimeout(resolve, 300, "restore"))]);
    finishRestore();
    await restoreInProgress;

    expect(settledFirst).toBe("restore");
    expect(await agentWrite).toBe(5);
  });

  it("leaves the file at the current version when restores and agent writes run at once", async () => {
    const fixture = await fixtureWithFourVersions();

    await Promise.all(
      [1, 2, 3, 6, 7, 8].map(async (version) =>
        version < 4
          ? postJson(server, specsPath(fixture, "/v1/cues/restore"), { version })
          : writeAgentSpec(fixture.context, CUES_ADDRESS, cueSheetVersion(version)),
      ),
    );

    const current = (await (await getRequest(server, specsPath(fixture, "/v1/cues"))).json()) as { version: number; content: unknown };
    expect(current.version).toBe(10);
    expect(JSON.parse(await readFile(join(fixture.projectRoot, "work/cues/v1.json"), "utf8"))).toEqual(current.content);
  });

  it("restores the file history of agent writes: each one snapshots the file it replaces", async () => {
    const fixture = await fixtureWithFourVersions();

    for (const version of [1, 2, 3]) {
      const snapshot = await readFile(join(fixture.projectRoot, `work/versions/cues/v1.v${version}.json`), "utf8");
      expect(JSON.parse(snapshot)).toEqual(cueSheetVersion(version));
    }
  });

  it("keeps every earlier version: restore appends, it never deletes", async () => {
    const fixture = await fixtureWithFourVersions();
    await postJson(server, specsPath(fixture, "/v1/cues/restore"), { version: 1 });

    const response = await getRequest(server, specsPath(fixture, "/v1/cues/versions"));

    const { versions } = (await response.json()) as { versions: { version: number; author: string }[] };
    expect(versions.map((entry) => [entry.version, entry.author])).toEqual([
      [5, "user"],
      [4, "agent"],
      [3, "agent"],
      [2, "agent"],
      [1, "agent"],
    ]);
  });

  it("is a 404 for a version that does not exist", async () => {
    const fixture = await fixtureWithFourVersions();
    const response = await postJson(server, specsPath(fixture, "/v1/cues/restore"), { version: 9 });
    expect(response.status).toBe(404);
  });

  it("is a 404 for a spec of another project", async () => {
    await fixtureWithFourVersions();
    const otherProject = await insertProject(server);
    const response = await postJson(server, `/api/projects/${otherProject.id}/specs/v1/cues/restore`, { version: 1 });
    expect(response.status).toBe(404);
  });

  it("is a 404 for a kind outside the spec kinds", async () => {
    const fixture = await fixtureWithFourVersions();
    const response = await postJson(server, specsPath(fixture, "/v1/secrets/restore"), { version: 1 });
    expect(response.status).toBe(404);
  });
});

describe("reading spec versions", () => {
  it("lists each spec with its current version", async () => {
    const fixture = await fixtureWithFourVersions();
    const response = await getRequest(server, specsPath(fixture));
    expect(await response.json()).toEqual({ specs: [{ videoId: "v1", kind: "cues", currentVersion: 4 }] });
  });

  it("returns the content of one version, and the current one without ?version", async () => {
    const fixture = await fixtureWithFourVersions();

    const second = await getRequest(server, specsPath(fixture, "/v1/cues?version=2"));
    const current = await getRequest(server, specsPath(fixture, "/v1/cues"));

    expect(await second.json()).toMatchObject({ videoId: "v1", kind: "cues", version: 2, author: "agent", note: null, content: cueSheetVersion(2) });
    expect(await current.json()).toMatchObject({ version: 4, content: cueSheetVersion(4) });
  });
});
