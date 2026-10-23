// Created by The Angelo Umali.
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Connection } from "../api/agent-client.ts";
import { connectionQuery } from "../api/queries.ts";
import { buttonClass } from "../components/button-class.ts";
import { TERMINAL_PENDING_LABEL } from "../copy/claude.ts";
import { ApiKeyControls } from "../setup/api-key-card.tsx";
import { ChoiceCard } from "../setup/choice-card.tsx";
import { CloudControls } from "../setup/cloud-card.tsx";
import { DoctorPanel } from "../setup/doctor-panel.tsx";
import { TerminalControls } from "../setup/terminal-card.tsx";

type Mode = NonNullable<Connection["mode"]>;

const CARDS: readonly { mode: Mode; title: string; badges: readonly string[]; description: string }[] = [
  {
    mode: "api_key",
    title: "Paste an Anthropic API key",
    badges: ["Recommended"],
    description: "Billed per use to your Anthropic account. The quickest way in.",
  },
  {
    mode: "cloud",
    title: "Use my cloud provider",
    badges: ["Advanced"],
    description: "Run Claude through Amazon Bedrock, Vertex AI, Microsoft Foundry or Claude Platform on AWS, using the profile already on this computer.",
  },
  {
    mode: "terminal",
    title: "Use Claude Code in a terminal (your own sign-in)",
    badges: ["Opt-in", TERMINAL_PENDING_LABEL],
    description: "Uses the Claude Code you installed and your own Claude plan.",
  },
];

function ConnectChoices({ connection }: { readonly connection: Connection }) {
  // No default: a fresh install picks nothing until the user does (plan: setup never auto-selects a mode).
  const [chosen, setChosen] = useState<Mode | null>(connection.mode);
  const controls: Record<Mode, ReactNode> = {
    api_key: <ApiKeyControls connection={connection} />,
    cloud: <CloudControls connection={connection} />,
    terminal: <TerminalControls connection={connection} />,
  };
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-h3 font-semibold text-copy">How should the studio reach Claude?</legend>
      {CARDS.map((card) => (
        <ChoiceCard key={card.mode} value={card.mode} {...card} isSelected={chosen === card.mode} onSelect={() => setChosen(card.mode)}>
          {controls[card.mode]}
        </ChoiceCard>
      ))}
    </fieldset>
  );
}

export function SetupRoute() {
  const connection = useQuery(connectionQuery());
  const isConnected = Boolean(connection.data?.mode);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-label font-semibold text-copy-muted uppercase">Setup · step 1 of 2</p>
        <h1 className="font-display text-h2 font-extrabold uppercase font-condensed">Connect Claude</h1>
        <p className="max-w-[65ch] text-lede text-copy-muted">
          The studio runs Claude on this computer, using your own access. Pick one way in. You can change it later in Settings.
        </p>
      </header>
      {connection.isError ? (
        <p role="alert" className="text-ui text-danger">
          The studio could not read its Claude connection: {connection.error.message}
        </p>
      ) : null}
      {connection.data ? <ConnectChoices connection={connection.data} /> : null}
      <DoctorPanel />
      <div className="flex flex-wrap items-center gap-4">
        {isConnected ? (
          <Link to="/" className={buttonClass("primary")}>
            Continue
          </Link>
        ) : (
          <>
            <button type="button" disabled className={buttonClass("primary")} aria-describedby="setup-gate">
              Continue
            </button>
            <p id="setup-gate" className="text-ui text-copy-muted">
              Connect Claude one way first.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
