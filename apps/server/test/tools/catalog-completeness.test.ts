// Created by The Angelo Umali.
import { STUDIO_TOOLS } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { studioToolCatalog, studioTwinCatalog } from "../../src/tools/catalog.ts";

const contractNames = Object.keys(STUDIO_TOOLS).sort();
const namesOf = (tools: readonly { name: string }[]) => tools.map((studioTool) => studioTool.name).sort();

describe("studio tool catalog", () => {
  // `approve` is the -p fallback's permission prompt, so only the twin serves it.
  it("has a handler for every contract except approve", () => {
    expect(namesOf(studioToolCatalog())).toEqual(contractNames.filter((name) => name !== "approve"));
  });

  it("serves every contract, once each, through the stdio twin", () => {
    expect(namesOf(studioTwinCatalog())).toEqual(contractNames);
  });
});
