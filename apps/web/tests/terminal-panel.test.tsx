// Created by The Angelo Umali.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { API_ROUTES, type AuthMode } from "@zks/shared";
import { describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "../src/terminal/terminal-panel.tsx";
import { jsonResponse, PROJECT_ID } from "./fakes.ts";
import { stubFetch } from "./render.tsx";

// The pane opens a socket; this test is about which session the panel hands it.
vi.mock("../src/terminal/TerminalPane.tsx", () => ({
  TerminalPane: ({ sessionId, agentLabel }: { sessionId: string; agentLabel: string }) => <p>{`${agentLabel} terminal ${sessionId}`}</p>,
}));

describe("TerminalPanel", () => {
  it("opens the newly connected agent's terminal after a switch, instead of the closed one", async () => {
    const sessionIds = [crypto.randomUUID(), crypto.randomUUID()];
    let opened = 0;
    stubFetch({
      [`GET ${API_ROUTES.listProjects.path}`]: () => jsonResponse({ projects: [] }),
      [`POST ${API_ROUTES.openTerminal.path.replace(":projectId", PROJECT_ID)}`]: () => jsonResponse({ sessionId: sessionIds[opened++] }),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const panel = (mode: AuthMode) => (
      <QueryClientProvider client={queryClient}>
        <TerminalPanel projectId={PROJECT_ID} mode={mode} />
      </QueryClientProvider>
    );
    const { rerender } = render(panel("terminal"));
    expect(await screen.findByText(`Claude Code terminal ${sessionIds[0]}`)).toBeInTheDocument();

    rerender(panel("codex_terminal"));

    expect(await screen.findByText(`Codex terminal ${sessionIds[1]}`)).toBeInTheDocument();
  });
});
