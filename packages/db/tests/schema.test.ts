// Created by The Angelo Umali.
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { DELIVERABLE_KINDS, JOB_LANES, JOB_STATUSES, RULE_TEXT_MAX_CHARS, SPEC_KINDS } from "@zks/shared";
import * as schema from "../schema.ts";

const tables = Object.values(schema).filter((exported) => exported instanceof PgTable);
const tableConfigByName = Object.fromEntries(tables.map((table) => [getTableConfig(table).name, getTableConfig(table)]));

function columnNames(tableName: string): string[] {
  return (tableConfigByName[tableName]?.columns ?? []).map((column) => column.name).sort();
}

describe("Drizzle schema (plan §8)", () => {
  it("defines the plan's tables, including rules", () => {
    expect(Object.keys(tableConfigByName).sort()).toEqual([
      "agent_sessions",
      "deliverables",
      "edit_spec_versions",
      "edit_specs",
      "events",
      "jobs",
      "media_assets",
      "projects",
      "providers",
      "rules",
      "settings",
      "transcripts",
    ]);
  });

  it("keeps every table in the studio schema, off Supabase's public Data API", () => {
    expect(tables.map((table) => getTableConfig(table).schema)).toEqual(tables.map(() => "studio"));
  });

  it("gives rules exactly the plan's columns and a 500-char check", () => {
    expect(columnNames("rules")).toEqual(["created_at", "enabled", "id", "source_quote", "text"]);
    const ruleChecks = tableConfigByName.rules?.checks ?? [];
    expect(ruleChecks.map((check) => check.name)).toEqual(["rules_text_length"]);
    expect(RULE_TEXT_MAX_CHARS).toBe(500);
  });

  it("builds its enums from the shared contract lists", () => {
    expect(schema.specKind.enumValues).toEqual([...SPEC_KINDS]);
    expect(schema.jobLane.enumValues).toEqual([...JOB_LANES]);
    expect(schema.jobStatus.enumValues).toEqual([...JOB_STATUSES]);
    expect(schema.deliverableKind.enumValues).toEqual([...DELIVERABLE_KINDS]);
    expect(schema.specKind.schema).toBe("studio");
  });

  it("stores no credential: providers keep only the key's last 4", () => {
    expect(columnNames("providers")).toEqual(["created_at", "id", "is_default", "key_last4", "label", "mode"]);
  });

  it("uses a bigint identity on events as the SSE cursor", () => {
    const eventIdColumn = tableConfigByName.events?.columns.find((column) => column.name === "id");
    expect(eventIdColumn?.columnType).toBe("PgBigInt53");
    expect(eventIdColumn?.generatedIdentity?.type).toBe("always");
  });

  it("stores media paths relative to the project, never absolute", () => {
    expect(columnNames("media_assets")).toContain("rel_path");
    expect(columnNames("media_assets")).not.toContain("path");
  });
});
