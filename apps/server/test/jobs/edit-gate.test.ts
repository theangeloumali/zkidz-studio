// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { EditGate, editGateKey, gateRenderJobs } from "../../src/jobs/edit-gate.ts";
import type { JobHandler, JobRunner } from "../../src/jobs/job-runner.ts";
import { RENDER_JOB_KINDS } from "../../src/jobs/spec-snapshot.ts";

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => (resolve = settle));
  return { promise, resolve };
}

describe("EditGate", () => {
  // Codex review: checking for jobs before a preview left a render free to start while the preview rewrote its EDL.
  it("refuses a preview while a job reads the video, and lets jobs share it", async () => {
    const gate = new EditGate();
    const render = deferred();
    const rendering = gate.whileReading("p:v1", () => render.promise);
    const covers = gate.whileReading("p:v1", () => Promise.resolve("covers"));
    expect(await covers).toBe("covers");
    expect(gate.tryWriting("p:v1", () => Promise.resolve("preview"))).toBeUndefined();
    expect(await gate.tryWriting("p:v2", () => Promise.resolve("other video"))).toBe("other video");
    render.resolve();
    await rendering;
    expect(await gate.tryWriting("p:v1", () => Promise.resolve("preview"))).toBe("preview");
  });

  it("holds a job that starts during a preview until the preview ends, even when it fails", async () => {
    const gate = new EditGate();
    const preview = deferred();
    const order: string[] = [];
    const previewing = gate.tryWriting("p:v1", async () => {
      await preview.promise;
      order.push("preview");
      throw new Error("engine refused");
    });
    const rendering = gate.whileReading("p:v1", () => Promise.resolve(order.push("render")));
    expect(gate.tryWriting("p:v1", () => Promise.resolve("second preview"))).toBeUndefined();
    preview.resolve();
    await expect(previewing).rejects.toThrow("engine refused");
    await rendering;
    expect(order).toEqual(["preview", "render"]);
  });

  it("wraps every render job kind so the job holds its video while it runs", async () => {
    const gate = new EditGate();
    const wrapped = new Map<string, JobHandler>();
    const finish = deferred();
    const runner = {
      wrapHandler: (kind: string, wrap: (handler: JobHandler) => JobHandler) =>
        wrapped.set(
          kind,
          wrap(() => finish.promise),
        ),
    };
    gateRenderJobs(runner as unknown as JobRunner, gate);
    expect([...wrapped.keys()]).toEqual(RENDER_JOB_KINDS);
    const job = { projectId: "p", videoId: "v1" } as Parameters<JobHandler>[0];
    const rendering = wrapped.get("render_master")?.(job, () => Promise.resolve(), new AbortController().signal);
    expect(gate.tryWriting(editGateKey("p", "v1"), () => Promise.resolve("preview"))).toBeUndefined();
    finish.resolve();
    await rendering;
    expect(await gate.tryWriting(editGateKey("p", "v1"), () => Promise.resolve("preview"))).toBe("preview");
  });
});
