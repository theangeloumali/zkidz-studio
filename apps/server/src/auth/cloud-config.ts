// Created by The Angelo Umali.
// Mode B provider variables (plan §6.6, ADR 0002). Credentials stay in the user's cloud CLI profile, never here.
import type { CLOUD_PROVIDERS } from "@zks/shared";

export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

interface ProviderVariables {
  /** Set to "1" by the server; a user-supplied value for it is rejected. */
  readonly switchName: string;
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

export const PROVIDER_VARIABLES: Readonly<Record<CloudProvider, ProviderVariables>> = {
  bedrock: { switchName: "CLAUDE_CODE_USE_BEDROCK", required: ["AWS_REGION"], optional: ["AWS_PROFILE"] },
  vertex: { switchName: "CLAUDE_CODE_USE_VERTEX", required: ["CLOUD_ML_REGION", "ANTHROPIC_VERTEX_PROJECT_ID"], optional: [] },
  foundry: { switchName: "CLAUDE_CODE_USE_FOUNDRY", required: ["ANTHROPIC_FOUNDRY_RESOURCE"], optional: [] },
  anthropicAws: { switchName: "CLAUDE_CODE_USE_ANTHROPIC_AWS", required: ["ANTHROPIC_AWS_WORKSPACE_ID", "AWS_REGION"], optional: ["AWS_PROFILE"] },
};

export class CloudConfigError extends Error {
  override readonly name = "CloudConfigError";
}

/** Returns only the provider's documented variables; anything else (a secret, a base URL) is a 400, not a silent drop. */
export function parseCloudValues(provider: CloudProvider, values: Readonly<Record<string, string>>): Record<string, string> {
  const { required, optional } = PROVIDER_VARIABLES[provider];
  const allowedNames = new Set([...required, ...optional]);
  for (const [name, value] of Object.entries(values)) {
    if (!allowedNames.has(name)) throw new CloudConfigError(`${name} is not a ${provider} setting`);
    if (value.trim() === "" || /[\r\n\0]/.test(value)) throw new CloudConfigError(`${name} must be a single non-empty line`);
  }
  const missingName = required.find((name) => values[name] === undefined);
  if (missingName !== undefined) throw new CloudConfigError(`${missingName} is required for ${provider}`);
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.trim()]));
}
