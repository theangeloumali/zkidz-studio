// Created by The Angelo Umali.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAgentInstructions } from "../../../src/terminal/agents/instructions.ts";

const PLUGIN_DIR = fileURLToPath(new URL("../../../../../plugin/", import.meta.url));

describe("buildAgentInstructions", () => {
  it("joins the rules, the edit-director body and an index of the other skills", async () => {
    const instructions = await buildAgentInstructions({ rulesText: "RULE: keep cuts tight.", pluginDir: PLUGIN_DIR });

    expect(instructions.startsWith("RULE: keep cuts tight.")).toBe(true);
    expect(instructions).toContain("# ");
    expect(instructions).not.toContain("name: edit-director");
    expect(instructions).toMatch(/^- captions: \S/m);
    expect(instructions).toMatch(/^- style-rules: \S/m);
    expect(instructions).not.toMatch(/^- edit-director:/m);
    expect(instructions).toContain("read_skill");
  });
});
