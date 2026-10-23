// Created by The Angelo Umali.
import { useState } from "react";
import { connectTerminal, type Connection } from "../api/agent-client.ts";
import { buttonClass } from "../components/button-class.ts";
import { ExternalLink } from "../components/external-link.tsx";
import { CLAUDE_LINKS, MIN_CLAUDE_VERSION, TERMINAL_DISCLOSURE, TERMINAL_TRUST_HINT } from "../copy/claude.ts";
import { meetsMinimumVersion } from "./claude-version.ts";
import { StatusLine, errorText } from "./status-line.tsx";
import { useConnect } from "./use-connect.ts";

function VersionNote({ version }: { readonly version: string | null }) {
  if (version === null) {
    return (
      <p className="text-ui text-danger">
        Claude Code was not found on this computer. <ExternalLink href={CLAUDE_LINKS.install}>Install Claude Code</ExternalLink>, or use an API key.
      </p>
    );
  }
  if (!meetsMinimumVersion(version)) {
    return (
      <p className="text-ui text-danger">
        Claude Code {version} is older than {MIN_CLAUDE_VERSION}, the oldest version the studio supports.{" "}
        <ExternalLink href={CLAUDE_LINKS.install}>Update Claude Code</ExternalLink>, or use an API key.
      </p>
    );
  }
  return <p className="text-ui text-copy-muted">Claude Code {version} found on this computer.</p>;
}

export function TerminalControls({ connection }: { readonly connection: Connection }) {
  const [hasAccepted, setHasAccepted] = useState(false);
  const enable = useConnect(connectTerminal);
  const isUsable = connection.claudeVersion !== null && meetsMinimumVersion(connection.claudeVersion);
  const isOn = connection.mode === "terminal";

  return (
    <>
      <VersionNote version={connection.claudeVersion} />
      <p className="max-w-[65ch] text-ui text-copy-muted">
        {TERMINAL_DISCLOSURE} Read <ExternalLink href={CLAUDE_LINKS.terms}>Anthropic&apos;s terms</ExternalLink>.
      </p>
      <label className="flex cursor-pointer items-start gap-3 text-ui text-copy">
        <input
          type="checkbox"
          checked={hasAccepted}
          onChange={(event) => setHasAccepted(event.currentTarget.checked)}
          className="mt-1 size-5 shrink-0 accent-accent"
        />
        I understand, and I want to use my own Claude Code sign-in.
      </label>
      <div>
        <button
          type="button"
          className={buttonClass("secondary")}
          disabled={!hasAccepted || !isUsable || enable.isPending}
          onClick={() => enable.mutate(undefined)}
        >
          Use terminal mode
        </button>
      </div>
      <StatusLine
        text={
          enable.isPending
            ? "Turning on terminal mode…"
            : enable.isError
              ? errorText(enable.error, "Terminal mode could not start")
              : isOn
                ? "Terminal mode is on."
                : ""
        }
        tone={enable.isError ? "danger" : isOn ? "success" : "neutral"}
      />
      {isOn ? <p className="max-w-[65ch] text-ui-sm text-copy-muted">{TERMINAL_TRUST_HINT}</p> : null}
    </>
  );
}
