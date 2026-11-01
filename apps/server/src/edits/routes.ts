// Created by The Angelo Umali.
// The edit list routes, plus the recorder that fills them; registered before the agent routes so it can see accepted answers.
import type { StudioDatabase } from "@zks/db";
import { API_ROUTES } from "@zks/shared";
import type { Hono } from "hono";
import { findProjectOrThrow } from "../projects/project-store.ts";
import type { EditRecorder } from "./edit-recorder.ts";
import { listLatestEdits, listProjectEdits } from "./edit-store.ts";

interface EditRouteDeps {
  readonly database: StudioDatabase;
  /** Started and stopped by whoever owns the database (main.ts, the test server), so it stops before the database closes. */
  readonly editRecorder: EditRecorder;
}

export function registerEdits(app: Hono, deps: EditRouteDeps): void {
  const { database, editRecorder: recorder } = deps;
  recordAcceptedAnswers(app, recorder);

  // Flushing first queues behind every event already delivered, so a read never trails the stream that prompted it.
  app.get(API_ROUTES.listEdits.path, async (c) => {
    const project = await findProjectOrThrow(database, c.req.param("projectId"));
    await recorder.flush();
    return c.json({ edits: await listProjectEdits(database, project.id) });
  });

  app.get(API_ROUTES.latestEdits.path, async (c) => {
    await recorder.flush();
    return c.json({ edits: await listLatestEdits(database) });
  });
}

/** No store keeps question answers, so the edit reads them off a decision the agent routes accepted. */
function recordAcceptedAnswers(app: Hono, recorder: EditRecorder): void {
  app.use(API_ROUTES.decide.path, async (c, next) => {
    await next();
    if (c.res.status !== 200) return;
    const decision = API_ROUTES.decide.body.safeParse(await c.req.json<unknown>());
    if (decision.success && decision.data.kind === "question") await recorder.recordAnswers(c.req.param("projectId"), decision.data.answers);
  });
}
