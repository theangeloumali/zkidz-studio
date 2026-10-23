// Created by The Angelo Umali.
import { useQuery } from "@tanstack/react-query";
import type { StudioEvent } from "@zks/shared";
import { Link } from "react-router";
import { connectionQuery } from "../api/queries.ts";
import { buttonClass } from "../components/button-class.ts";
import { useEventsStore } from "../events/store.ts";
import { AgentPane } from "./agent-pane.tsx";

// A stable empty list, so the store selector does not hand React a new array every render.
const NO_EVENTS: readonly StudioEvent[] = [];

/** The editor's agent column: asks for setup first when no way to reach Claude is configured. */
export function ProjectAgent({ projectId }: { readonly projectId: string }) {
  const connection = useQuery(connectionQuery());
  const events = useEventsStore((state) => state.feeds[projectId]?.events ?? NO_EVENTS);
  const mode = connection.data?.mode;

  if (connection.isPending) return <p className="text-ui text-copy-muted">Checking how the studio reaches Claude…</p>;
  if (connection.isError)
    return (
      <p role="alert" className="text-ui text-danger">
        {connection.error.message}
      </p>
    );
  if (!mode)
    return (
      <div className="flex flex-col items-start gap-3 rounded-card border border-line bg-bg-elevated p-4">
        <p className="text-ui text-copy">Connect Claude before the agent can edit this project.</p>
        <Link to="/setup" className={buttonClass("primary")}>
          Connect Claude
        </Link>
      </div>
    );
  return <AgentPane projectId={projectId} events={events} mode={mode} />;
}
