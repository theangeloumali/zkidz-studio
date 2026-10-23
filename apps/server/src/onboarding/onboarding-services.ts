// Created by The Angelo Umali.
// Phase 6 routes: the house style, the shipped presets, starting from a template, and the no-footage demo project.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StudioDatabase } from "@zks/db";
import { projects } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { projectDir } from "../config.ts";
import { toProjectDto, type JobRow } from "../dto.ts";
import type { EventBus } from "../events/event-bus.ts";
import { HttpError, parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import type { JobRunner } from "../jobs/job-runner.ts";
import { createProject, findProjectOrThrow } from "../projects/project-store.ts";
import type { ToolContext } from "../tools/context.ts";
import { writeJobResult } from "../tools/job-results.ts";
import type { DemoRunner } from "./demo-runner.ts";
import { DEFAULT_PRESETS_DIR, loadPresets, type Presets } from "./presets.ts";
import { startTemplate } from "./start-template.ts";
import { readStyleChoice, writeStyleChoice } from "./style-choice.ts";

export type { DemoRunner } from "./demo-runner.ts";

const DEMO_TITLE = "Demo project";
/** make_demo.py only writes into an empty folder or one carrying this marker. */
const DEMO_MARKER = ".zks-demo";
const DEMO_JOB_KIND = "demo";

export interface OnboardingDeps {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly eventBus: EventBus;
  readonly jobRunner: JobRunner;
  readonly demoRunner: DemoRunner;
  readonly presetsDir?: string;
}

export interface OnboardingServices {
  readonly registerRoutes: (app: Hono) => void;
}

export function createOnboardingServices(deps: OnboardingDeps): OnboardingServices {
  let presets: Promise<Presets> | undefined;
  const readPresets = () => (presets ??= loadPresets(deps.presetsDir ?? DEFAULT_PRESETS_DIR));
  deps.jobRunner.registerHandler(DEMO_JOB_KIND, (job) => renderDemo(deps, job));

  return {
    registerRoutes: (app) => {
      app.get(API_ROUTES.getStyle.path, async (c) => c.json(await readStyleChoice(deps.database)));

      app.put(API_ROUTES.setStyle.path, async (c) => {
        const choice = parseOrBadRequest(API_ROUTES.setStyle.body, await readJsonBody(c));
        await writeStyleChoice(deps.database, choice);
        return c.json(choice);
      });

      app.get(API_ROUTES.listStylePresets.path, async (c) => c.json({ styles: (await readPresets()).styles }));
      app.get(API_ROUTES.listTemplates.path, async (c) => c.json({ templates: (await readPresets()).templates }));

      app.post(API_ROUTES.startTemplate.path, async (c) => {
        const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
        const request = parseOrBadRequest(API_ROUTES.startTemplate.body, await readJsonBody(c));
        const template = (await readPresets()).templates.find((candidate) => candidate.id === request.templateId);
        if (template === undefined) throw new HttpError(400, `No template named ${request.templateId}`);
        const { ingestJobId } = await startTemplate(toolContextFor(deps, project.id), template, request);
        return c.json({ templateId: template.id, ingestMode: template.ingestMode, ingestJobId });
      });

      app.post(API_ROUTES.openDemoProject.path, async (c) => {
        const project = await createProject(deps.database, deps.studioHome, DEMO_TITLE);
        await writeFile(join(projectDir(deps.studioHome, project.slug), DEMO_MARKER), "");
        await deps.jobRunner.enqueue({ projectId: project.id, kind: DEMO_JOB_KIND, videoId: project.videoId, lane: "gpu" });
        return c.json(toProjectDto(project));
      });
    },
  };
}

/** The route acts for the user, so nothing asks for approval; ingest is an auto-approved tool anyway. */
function toolContextFor(deps: OnboardingDeps, projectId: string): ToolContext {
  return {
    projectId,
    studioHome: deps.studioHome,
    db: deps.database,
    events: deps.eventBus,
    jobs: deps.jobRunner,
    requestApproval: () => Promise.resolve("deny"),
    askQuestions: () => Promise.resolve(null),
  };
}

async function renderDemo(deps: OnboardingDeps, job: JobRow): Promise<void> {
  const [project] = await deps.database.select().from(projects).where(eq(projects.id, job.projectId));
  if (project === undefined) throw new Error("the demo project no longer exists");
  const projectRoot = projectDir(deps.studioHome, project.slug);
  await writeJobResult(projectRoot, job.id, await deps.demoRunner.run(projectRoot));
}
