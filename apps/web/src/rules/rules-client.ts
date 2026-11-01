// Created by The Angelo Umali.
import { queryOptions } from "@tanstack/react-query";
import { API_ROUTES } from "@zks/shared";
import { requestJson, routeUrl } from "../api/client.ts";

const { listRules, createRule, deleteRule, updateRule } = API_ROUTES;

export const rulesQueryKey = ["rules"] as const;

async function fetchRules() {
  const { rules } = await requestJson(listRules.response, listRules.path);
  return rules;
}

export const rulesQuery = () => queryOptions({ queryKey: rulesQueryKey, queryFn: fetchRules });

/** `sourceQuote` records where a rule came from, e.g. the lesson card an edit suggested it on. */
export function addRule(text: string, sourceQuote?: string) {
  const body = sourceQuote === undefined ? { text } : { text, sourceQuote };
  return requestJson(createRule.response, createRule.path, { method: createRule.method, body });
}

export function removeRule(ruleId: string) {
  return requestJson(deleteRule.response, routeUrl(deleteRule.path, { ruleId }), { method: deleteRule.method });
}

export function setRuleEnabled(ruleId: string, isEnabled: boolean) {
  return requestJson(updateRule.response, routeUrl(updateRule.path, { ruleId }), { method: updateRule.method, body: { isEnabled } });
}
