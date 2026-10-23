// Created by The Angelo Umali.
import { useId, useState } from "react";
import { connectCloud, type CloudProvider, type CloudSettings, type Connection } from "../api/agent-client.ts";
import { buttonClass } from "../components/button-class.ts";
import { FIELD_CLASS } from "../components/field-class.ts";
import { StatusLine, errorText, type StatusTone } from "./status-line.tsx";
import { useConnect } from "./use-connect.ts";

const PROVIDER_LABELS: Record<CloudProvider, string> = {
  bedrock: "Amazon Bedrock",
  vertex: "Vertex AI",
  foundry: "Microsoft Foundry",
  anthropicAws: "Claude Platform on AWS",
};
const PROVIDERS = Object.keys(PROVIDER_LABELS) as CloudProvider[];

interface ProviderField {
  readonly name: string;
  readonly label: string;
  readonly isOptional?: boolean;
}

// Mirrors the server's PROVIDER_VARIABLES, which rejects any other name.
const AWS_REGION: ProviderField = { name: "AWS_REGION", label: "AWS region" };
const AWS_PROFILE: ProviderField = { name: "AWS_PROFILE", label: "AWS profile (optional)", isOptional: true };
const PROVIDER_FIELDS: Record<CloudProvider, readonly ProviderField[]> = {
  bedrock: [AWS_REGION, AWS_PROFILE],
  vertex: [
    { name: "CLOUD_ML_REGION", label: "Region" },
    { name: "ANTHROPIC_VERTEX_PROJECT_ID", label: "Google Cloud project ID" },
  ],
  foundry: [{ name: "ANTHROPIC_FOUNDRY_RESOURCE", label: "Foundry resource name" }],
  anthropicAws: [{ name: "ANTHROPIC_AWS_WORKSPACE_ID", label: "Workspace ID" }, AWS_REGION, AWS_PROFILE],
};

/** Only this provider's filled-in fields are sent; blank optional ones are left to the CLI's defaults. */
function toSettings(provider: CloudProvider, entered: Readonly<Record<string, string>>): CloudSettings {
  const values: Record<string, string> = {};
  for (const { name } of PROVIDER_FIELDS[provider]) {
    const value = entered[name]?.trim();
    if (value) values[name] = value;
  }
  return { provider, values };
}

function profileStatus(connection: Connection, check: ReturnType<typeof useConnect<CloudSettings>>): [string, StatusTone] {
  if (check.isPending) return ["Checking profile…", "neutral"];
  if (check.isError) return [errorText(check.error, "The studio could not use this profile"), "danger"];
  if (connection.mode === "cloud" && connection.provider) return [`Profile works · ${PROVIDER_LABELS[connection.provider]}`, "success"];
  return ["", "neutral"];
}

export function CloudControls({ connection }: { readonly connection: Connection }) {
  const idPrefix = useId();
  const selectId = `${idPrefix}-provider`;
  const [provider, setProvider] = useState<CloudProvider>(connection.provider ?? "bedrock");
  const [entered, setEntered] = useState<Record<string, string>>({});
  const check = useConnect(connectCloud);
  const [statusText, statusTone] = profileStatus(connection, check);

  return (
    <>
      <label htmlFor={selectId} className="text-label font-semibold text-copy">
        Provider
      </label>
      <select id={selectId} value={provider} onChange={(event) => setProvider(event.currentTarget.value as CloudProvider)} className={FIELD_CLASS}>
        {PROVIDERS.map((value) => (
          <option key={value} value={value}>
            {PROVIDER_LABELS[value]}
          </option>
        ))}
      </select>
      {PROVIDER_FIELDS[provider].map(({ name, label, isOptional }) => {
        const fieldId = `${idPrefix}-${name}`;
        return (
          <div key={name} className="flex flex-col gap-1">
            <label htmlFor={fieldId} className="text-label font-semibold text-copy">
              {label}
            </label>
            <input
              id={fieldId}
              value={entered[name] ?? ""}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setEntered((previous) => ({ ...previous, [name]: value }));
              }}
              required={!isOptional}
              autoComplete="off"
              spellCheck={false}
              className={`${FIELD_CLASS} font-mono`}
            />
          </div>
        );
      })}
      <button
        type="button"
        className={buttonClass("secondary", "self-start")}
        onClick={() => check.mutate(toSettings(provider, entered))}
        disabled={check.isPending}
      >
        Check profile
      </button>
      <StatusLine text={statusText} tone={statusTone} />
    </>
  );
}
