// Created by The Angelo Umali.
import { useQuery } from "@tanstack/react-query";
import { AGENT_LABELS, agentKindOfAuthMode } from "@zks/shared";
import { openTerminal } from "../api/agent-client.ts";
import { connectionQuery, queryKeys } from "../api/queries.ts";
import { buttonClass } from "../components/button-class.ts";
import { TerminalPane } from "./TerminalPane.tsx";

/** Opens the project's PTY once; Restart re-opens it (`--resume` keeps the id, so the key also carries the fetch time). */
export function TerminalPanel({ projectId }: { readonly projectId: string }) {
  const terminal = useQuery({
    queryKey: queryKeys.terminal(projectId),
    queryFn: () => openTerminal(projectId),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const connection = useQuery(connectionQuery());
  const agentLabel = AGENT_LABELS[agentKindOfAuthMode(connection.data?.mode)];
  const restart = () => void terminal.refetch();

  if (terminal.isPending) return <p className="text-ui text-copy-muted">Starting {agentLabel}…</p>;
  if (terminal.isError)
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-ui text-danger">
          {agentLabel} did not start: {terminal.error.message}
        </p>
        <button type="button" className={buttonClass("secondary", "self-start")} onClick={restart} disabled={terminal.isFetching}>
          Try again
        </button>
      </div>
    );
  const { sessionId } = terminal.data;
  return <TerminalPane key={`${sessionId}:${terminal.dataUpdatedAt}`} sessionId={sessionId} agentLabel={agentLabel} onRestart={restart} />;
}
