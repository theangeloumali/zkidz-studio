// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { CloudConfigError, parseCloudValues } from "../../src/auth/cloud-config.ts";

describe("parseCloudValues", () => {
  it("keeps a provider's documented non-secret values", () => {
    expect(parseCloudValues("vertex", { CLOUD_ML_REGION: "us-east5", ANTHROPIC_VERTEX_PROJECT_ID: "my-project" })).toEqual({
      CLOUD_ML_REGION: "us-east5",
      ANTHROPIC_VERTEX_PROJECT_ID: "my-project",
    });
  });

  it("rejects a variable outside the provider's list, such as a secret", () => {
    expect(() => parseCloudValues("bedrock", { AWS_REGION: "us-east-1", AWS_SECRET_ACCESS_KEY: "x" })).toThrow(CloudConfigError);
    expect(() => parseCloudValues("bedrock", { AWS_REGION: "us-east-1", AWS_SECRET_ACCESS_KEY: "x" })).toThrow(/AWS_SECRET_ACCESS_KEY/);
  });

  it("rejects the switch variable, which the server sets itself", () => {
    expect(() => parseCloudValues("foundry", { ANTHROPIC_FOUNDRY_RESOURCE: "r", CLAUDE_CODE_USE_FOUNDRY: "1" })).toThrow(CloudConfigError);
  });

  it("requires the provider's region or resource", () => {
    expect(() => parseCloudValues("anthropicAws", { AWS_REGION: "us-east-1" })).toThrow(/ANTHROPIC_AWS_WORKSPACE_ID/);
  });

  it("rejects values carrying a line break", () => {
    expect(() => parseCloudValues("bedrock", { AWS_REGION: "us-east-1\nAWS_PROFILE=other" })).toThrow(CloudConfigError);
  });
});
