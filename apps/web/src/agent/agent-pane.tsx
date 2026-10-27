// Created by The Angelo Umali.
import { useMutation } from "@tanstack/react-query";
import type { StudioEvent } from "@zks/shared";
import { Square } from "lucide-react";
import { useMemo, useState } from "react";
import { stopTurn, submitPrompt, type Connection } from "../api/agent-client.ts";
import { buttonClass } from "../components/button-class.ts";
import { TerminalPanel } from "../terminal/terminal-panel.tsx";
import { ActivityFeed } from "./activity-feed.tsx";
import { Composer } from "./composer.tsx";
import { summarizeSession } from "./feed-items.ts";
import { PaneTabs, type PaneTab } from "./pane-tabs.tsx";
import { UsageMeter } from "./usage-meter.tsx";

interface AgentPaneProps {
  readonly projectId: string;
  readonly events: readonly StudioEvent[];
  readonly mode: NonNullable<Connection["mode"]>;
}

/** The server routes the prompt and Stop to the PTY in terminal mode, or to the SDK otherwise. */
export function AgentPane({ projectId, events, mode }: AgentPaneProps) {
  const isTerminal = mode === "terminal";
  const summary = useMemo(() => summarizeSession(events), [events]);
  const [tab, setTab] = useState<PaneTab>("activity");
  const prompt = useMutation({ mutationFn: (text: string) => submitPrompt(projectId, text) });
  const stop = useMutation({ mutationFn: () => stopTurn(projectId) });

  function send(text: string): Promise<boolean> {
    return prompt.mutateAsync(text).then(
      () => true,
      () => false,
    );
  }

  const failure = prompt.error?.message ?? stop.error?.message;
  const activity = <ActivityFeed projectId={projectId} events={events} />;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {isTerminal ? <PaneTabs active={tab} onSelect={setTab} panels={{ activity, terminal: <TerminalPanel projectId={projectId} /> }} /> : activity}
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {isTerminal ? null : <UsageMeter summary={summary} />}
        {summary.isWorking ? (
          <button type="button" className={buttonClass("secondary", "self-start")} disabled={stop.isPending} onClick={() => stop.mutate()}>
            <Square aria-hidden="true" className="size-4" />
            Stop
          </button>
        ) : null}
        <Composer isFirstPrompt={!events.some((event) => event.type === "prompt.submitted")} isSending={prompt.isPending} onSend={send} />
        <p role="status" className="text-ui text-danger">
          {failure ? `Not sent: ${failure}` : ""}
        </p>
      </div>
    </div>
  );
}
