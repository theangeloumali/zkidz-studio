// Created by The Angelo Umali.
// Writes packages/shared/schema/*.json; a test fails when they drift from the zod contracts.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderSpecJsonSchemaFiles } from "../src/json-schema.ts";

const schemaDir = fileURLToPath(new URL("../schema/", import.meta.url));
const schemaFiles = renderSpecJsonSchemaFiles();

mkdirSync(schemaDir, { recursive: true });
for (const staleFile of readdirSync(schemaDir).filter((fileName) => !(fileName in schemaFiles))) rmSync(`${schemaDir}${staleFile}`);
for (const [fileName, fileContents] of Object.entries(schemaFiles)) writeFileSync(`${schemaDir}${fileName}`, fileContents);
console.log(`wrote ${Object.keys(schemaFiles).length} schema files to ${schemaDir}`);
