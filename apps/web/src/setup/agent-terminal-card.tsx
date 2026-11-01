// Created by The Angelo Umali.
import { API_ROUTES, isVersionAtLeast } from "@zks/shared";
import { useState } from "react";
import type { Connection } from "../api/agent-client.ts";
import { requestJson } from "../api/client.ts";
import { ExternalLink } from "../components/external-link.tsx";
import { Button } from "@/components/ui/button";
import { AGENT_COPY, type TerminalAgent, type TerminalAgentCopy } from "../copy/agents.ts";
import { StatusLine, errorText } from "./status-line.tsx";
import { useConnect } from "./use-connect.ts";

type AgentVersion = NonNullable<Connection["agentVersions"]>[TerminalAgent];

const CONNECT_ROUTES = { codex: API_ROUTES.connectCodexTerminal, opencode: API_ROUTES.connectOpenCodeTerminal } as const;

function connectAgent(agent: TerminalAgent): () => Promise<Connection> {
  const route = CONNECT_ROUTES[agent];
  return () => requestJson(route.response, route.path, { method: "POST", body: { hasAcceptedDisclosure: true } });
}

function VersionNote({ copy, installed }: { readonly copy: TerminalAgentCopy; readonly installed: AgentVersion | undefined }) {
  if (installed?.version == null) {
    return (
      <p className="text-ui text-danger">
        {copy.name} was not found on this computer. <ExternalLink href={copy.installUrl}>Install {copy.name}</ExternalLink>, or pick another way in.
      </p>
    );
  }
  if (!isVersionAtLeast(installed.version, installed.minVersion)) {
    return (
      <p className="text-ui text-danger">
        {copy.name} {installed.version} is older than {installed.minVersion}, the oldest version the studio supports.{" "}
        <ExternalLink href={copy.installUrl}>Update {copy.name}</ExternalLink>, or pick another way in.
      </p>
    );
  }
  return (
    <p className="text-ui text-copy-muted">
      {copy.name} {installed.version} found on this computer.
    </p>
  );
}

export function AgentTerminalControls({ agent, connection }: { readonly agent: TerminalAgent; readonly connection: Connection }) {
  const copy = AGENT_COPY[agent];
  const installed = connection.agentVersions?.[agent];
  const [hasAccepted, setHasAccepted] = useState(false);
  const enable = useConnect(connectAgent(agent));
  const isUsable = installed?.version != null && isVersionAtLeast(installed.version, installed.minVersion);
  const isOn = connection.mode === `${agent}_terminal`;

  return (
    <>
      <VersionNote copy={copy} installed={installed} />
      <p className="max-w-[65ch] text-ui text-copy-muted">
        {copy.disclosure} Read{" "}
        {copy.links.map((link, index) => (
          <span key={link.href}>
            {index > 0 ? " and " : null}
            <ExternalLink href={link.href}>{link.label}</ExternalLink>
          </span>
        ))}
        .
      </p>
      <label className="flex cursor-pointer items-start gap-3 text-ui text-copy">
        <input
          type="checkbox"
          checked={hasAccepted}
          onChange={(event) => setHasAccepted(event.currentTarget.checked)}
          className="mt-1 size-5 shrink-0 accent-accent"
        />
        {copy.consent}
      </label>
      <div>
        <Button variant="secondary" disabled={!hasAccepted || !isUsable || enable.isPending} onClick={() => enable.mutate(undefined)}>
          {copy.title}
        </Button>
      </div>
      <StatusLine
        text={
          enable.isPending
            ? `Turning on ${copy.name} terminal mode…`
            : enable.isError
              ? errorText(enable.error, `${copy.name} terminal mode could not start`)
              : isOn
                ? `${copy.name} terminal mode is on.`
                : ""
        }
        tone={enable.isError ? "danger" : isOn ? "success" : "neutral"}
      />
    </>
  );
}
