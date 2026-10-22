// Created by The Angelo Umali.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CUE_KINDS, renderSpecJsonSchemaFiles } from "../src/index.ts";
import { sampleCueByKind } from "./cue-samples.ts";
import { ASSET_ID, validCutSpec } from "./fixtures.ts";

const SCHEMA_DIR = fileURLToPath(new URL("../schema/", import.meta.url));
const schemaFiles = renderSpecJsonSchemaFiles();

function roundTripSchema(fileName: string) {
  const fileContents = schemaFiles[fileName];
  if (fileContents === undefined) throw new Error(`no schema file ${fileName}`);
  const parsedSchema = z.record(z.string(), z.unknown()).parse(JSON.parse(fileContents));
  return z.fromJSONSchema(parsedSchema);
}

describe("spec JSON Schema export (plan §7.7)", () => {
  it("emits one draft 2020-12 file per spec the engine reads", () => {
    expect(Object.keys(schemaFiles).sort()).toEqual([
      "caption-entries.json",
      "caption-phrases.json",
      "cue-sheet.json",
      "cut-spec.json",
      "insert-spec.json",
      "reel-cue-patches.json",
      "reel-spec.json",
    ]);
    for (const fileContents of Object.values(schemaFiles)) {
      expect(JSON.parse(fileContents)).toMatchObject({ $schema: "https://json-schema.org/draft/2020-12/schema" });
    }
  });

  it("keeps the committed schema files in step with the zod contracts (run pnpm -F @zks/shared schema:export)", () => {
    const committedFiles = Object.fromEntries(readdirSync(SCHEMA_DIR).map((fileName) => [fileName, readFileSync(`${SCHEMA_DIR}${fileName}`, "utf8")]));

    expect(committedFiles).toEqual(schemaFiles);
  });

  it("round-trips the cut spec: valid passes, a path field fails", () => {
    const cutSpecSchema = roundTripSchema("cut-spec.json");

    expect(cutSpecSchema.safeParse(validCutSpec).success).toBe(true);
    expect(cutSpecSchema.safeParse({ ...validCutSpec, source: "/etc/passwd" }).success).toBe(false);
  });

  it("round-trips the cue sheet with every kind still discriminated", () => {
    const cueSheetSchema = roundTripSchema("cue-sheet.json");

    expect(cueSheetSchema.safeParse(Object.values(sampleCueByKind)).success).toBe(true);
    expect(cueSheetSchema.safeParse([{ kind: "pipeline", at: 1, end: 2, steps: [] }]).success).toBe(false);
    for (const cueKind of CUE_KINDS) expect(schemaFiles["cue-sheet.json"]).toContain(`"const": "${cueKind}"`);
  });

  it("round-trips the insert spec", () => {
    const insertSpecSchema = roundTripSchema("insert-spec.json");

    expect(insertSpecSchema.safeParse([{ at: 1, end: 2, srcAssetId: ASSET_ID, srcAt: 0 }]).success).toBe(true);
    expect(insertSpecSchema.safeParse([{ at: 1, end: 2, src: "a.mp4", srcAt: 0 }]).success).toBe(false);
  });
});
