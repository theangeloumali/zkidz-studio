// Created by The Angelo Umali.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { ZksContext } from "./context.ts";
import { downloadVerified } from "./download.ts";
import type { ModelPin } from "@zks/shared/node";

export interface ModelStatus {
  name: string;
  file: string;
  sizeMb: number;
  fetchOnSetup: boolean;
  installed: boolean;
}

const BYTES_PER_MB = 1024 * 1024;

export function modelPath(context: ZksContext, model: ModelPin): string {
  return path.join(context.modelsDir, model.file);
}

/** A size match is the cheap presence check; downloads are hash-verified. */
export function listModels(context: ZksContext): ModelStatus[] {
  return Object.entries(context.lock.models).map(([name, model]) => {
    const filePath = modelPath(context, model);
    return {
      name,
      file: model.file,
      sizeMb: Math.round(model.size / BYTES_PER_MB),
      fetchOnSetup: model.fetchOnSetup,
      installed: existsSync(filePath) && statSync(filePath).size === model.size,
    };
  });
}

export async function fetchModel(context: ZksContext, name: string): Promise<{ downloaded: boolean }> {
  const model = context.lock.models[name];
  if (!model) throw new Error(`Unknown model "${name}". Known: ${Object.keys(context.lock.models).join(", ")}`);
  return downloadVerified({ url: model.url, sha256: model.sha256, destination: modelPath(context, model) });
}
