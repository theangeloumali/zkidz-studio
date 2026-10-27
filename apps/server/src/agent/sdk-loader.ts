// Created by The Angelo Umali.
// The agent SDK is imported on first use: loading it at start cost ~0.6 s of the 2 s budget (plan §9.5).
import { lazyImport } from "../lazy-import.ts";
import { deferredQueryHandle, type QueryFunction } from "./query-function.ts";

export const loadAgentSdk = lazyImport("The Claude Agent SDK", () => import("@anthropic-ai/claude-agent-sdk"));

export const lazySdkQuery: QueryFunction = (params) => deferredQueryHandle(loadAgentSdk().then((sdk) => sdk.query(params)));
