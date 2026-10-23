// Created by The Angelo Umali.
// Rules and per-project limits change only through these user-facing routes (plan §6.9); no MCP tool reaches them.
import type { StudioDatabase } from "@zks/db";
import { API_ROUTES } from "@zks/shared";
import type { Hono } from "hono";
import { parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import { readProjectSettings, updateProjectSettings } from "./project-settings.ts";
import { createRule, deleteRule, listRules, setRuleEnabled } from "./rule-store.ts";

export function registerRuleRoutes(app: Hono, deps: { readonly database: StudioDatabase }): void {
  const { database } = deps;

  app.get(API_ROUTES.listRules.path, async (c) => c.json({ rules: await listRules(database) }));

  app.post(API_ROUTES.createRule.path, async (c) => {
    const body = parseOrBadRequest(API_ROUTES.createRule.body, await readJsonBody(c));
    return c.json(await createRule(database, body), 201);
  });

  app.patch(API_ROUTES.updateRule.path, async (c) => {
    const { isEnabled } = parseOrBadRequest(API_ROUTES.updateRule.body, await readJsonBody(c));
    return c.json(await setRuleEnabled(database, c.req.param("ruleId"), isEnabled));
  });

  app.delete(API_ROUTES.deleteRule.path, async (c) => {
    await deleteRule(database, c.req.param("ruleId"));
    return c.json({ ok: true as const });
  });

  app.get(API_ROUTES.getProjectSettings.path, async (c) => {
    const project = await findProjectOrThrow(database, c.req.param("projectId"));
    return c.json(await readProjectSettings(database, project.id));
  });

  app.put(API_ROUTES.updateProjectSettings.path, async (c) => {
    const project = await findProjectOrThrow(database, c.req.param("projectId"));
    const patch = parseOrBadRequest(API_ROUTES.updateProjectSettings.body, await readJsonBody(c));
    return c.json(await updateProjectSettings(database, project.id, patch));
  });
}
