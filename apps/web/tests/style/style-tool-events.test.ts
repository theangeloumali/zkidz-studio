// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { latestFinishedStyleToolId } from "../../src/style/style-tool-events.ts";
import { SAMPLE_EVENTS } from "../event-fixtures.ts";

function called(toolUseId: string, name: string): StudioEvent {
  return { ...SAMPLE_EVENTS["tool.called"], toolUseId, name };
}

function finished(toolUseId: string): StudioEvent {
  return { ...SAMPLE_EVENTS["tool.finished"], toolUseId };
}

describe("latestFinishedStyleToolId", () => {
  it("is null while the style tool is still running", () => {
    expect(latestFinishedStyleToolId([called("t1", "mcp__studio__set_project_style")])).toBeNull();
  });

  it("names the newest finished set_project_style call", () => {
    const events = [
      called("t1", "mcp__studio__set_project_style"),
      finished("t1"),
      called("t2", "mcp__studio__transcribe"),
      finished("t2"),
      called("t3", "mcp__studio__set_project_style"),
      finished("t3"),
    ];

    expect(latestFinishedStyleToolId(events)).toBe("t3");
  });

  it("ignores other tools", () => {
    expect(latestFinishedStyleToolId([called("t1", "mcp__studio__transcribe"), finished("t1")])).toBeNull();
  });
});
