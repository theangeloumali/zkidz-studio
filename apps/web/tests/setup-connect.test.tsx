// Created by The Angelo Umali.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Connection, DoctorCheck } from "../src/api/agent-client.ts";
import { ROUTE_PATHS } from "../src/lib/routes.ts";
import { SetupRoute } from "../src/routes/setup.tsx";
import { jsonResponse } from "./fakes.ts";
import { renderWithProviders, requestBody, stubFetch } from "./render.tsx";

const NOT_CONNECTED: Connection = { mode: null, keyLast4: null, provider: null, claudeVersion: "2.1.300" };
const CHECKS: DoctorCheck[] = [
  { id: "ffmpeg", label: "ffmpeg", status: "pass", detail: "7.1 with NVENC" },
  { id: "chrome", label: "Chrome", status: "fail", detail: "Not found", fix: "Install Google Chrome" },
  { id: "database", label: "Data backend", status: "pass", detail: "Embedded database (PGlite)" },
];
const withDatabase = (database: DoctorCheck) => [...CHECKS.filter((check) => check.id !== "database"), database];
const dataBackendRow = async () => (await screen.findByRole("rowheader", { name: "Data backend" })).closest("tr") as HTMLElement;

function stubSetup(connection: Connection = NOT_CONNECTED, extra: Parameters<typeof stubFetch>[0] = {}) {
  return stubFetch({
    "GET /api/connect": () => jsonResponse(connection),
    "GET /api/doctor": () => jsonResponse({ checks: CHECKS }),
    ...extra,
  });
}

async function chooseApiKey(): Promise<void> {
  await userEvent.click(await screen.findByRole("radio", { name: /Paste an Anthropic API key/ }));
}

describe("SetupRoute", () => {
  it("links to the optional style step, connected or not", async () => {
    stubSetup();
    renderWithProviders(
      <Routes>
        <Route path={ROUTE_PATHS.setup} element={<SetupRoute />} />
        <Route path={ROUTE_PATHS.style} element={<p>Style page</p>} />
      </Routes>,
      ROUTE_PATHS.setup,
    );

    const link = await screen.findByRole("link", { name: "Pick a house style" });
    expect(link).toHaveAttribute("href", ROUTE_PATHS.style);
    await userEvent.click(link);
    expect(await screen.findByText("Style page")).toBeInTheDocument();
  });

  it("offers the three ways in, recommended first", async () => {
    stubSetup();
    renderWithProviders(<SetupRoute />);
    const group = await screen.findByRole("group", { name: "How should the studio reach Claude?" });
    const options = within(group).getAllByRole("radio");
    expect(options.map((option) => option.getAttribute("value"))).toEqual(["api_key", "cloud", "terminal"]);
    expect(within(group).getByText("Recommended")).toBeInTheDocument();
    expect(within(group).getByText("Advanced")).toBeInTheDocument();
    expect(within(group).getByText("Pending Anthropic approval")).toBeInTheDocument();
  });

  it("selects no way in on a fresh install", async () => {
    stubSetup();
    renderWithProviders(<SetupRoute />);
    const group = await screen.findByRole("group", { name: "How should the studio reach Claude?" });
    expect(within(group).queryAllByRole("radio", { checked: true })).toEqual([]);
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("shows the saved way in as the current choice", async () => {
    stubSetup({ ...NOT_CONNECTED, mode: "cloud", provider: "bedrock" });
    renderWithProviders(<SetupRoute />);
    expect(await screen.findByRole("radio", { name: /Use my cloud provider/ })).toBeChecked();
  });

  // The server caches the doctor's results, since some checks launch tools; only an explicit refresh runs them again.
  it("runs the doctor again for real when asked, not from the cache", async () => {
    const rerun: DoctorCheck[] = [{ ...CHECKS[1]!, status: "pass", detail: "Chrome for Testing 155", fix: undefined }];
    const fetchMock = stubSetup(NOT_CONNECTED, { "GET /api/doctor?refresh=1": () => jsonResponse({ checks: rerun }) });
    renderWithProviders(<SetupRoute />);
    await screen.findByText("7.1 with NVENC");

    await userEvent.click(screen.getByRole("button", { name: "Run checks again" }));

    expect(await screen.findByText("Chrome for Testing 155")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain("/api/doctor?refresh=1");
  });

  it("asks for a key before checking it", async () => {
    const fetchMock = stubSetup();
    renderWithProviders(<SetupRoute />);
    await chooseApiKey();
    await userEvent.click(screen.getByRole("button", { name: "Check key" }));
    expect(screen.getByText("Paste a key first.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/connect/api-key")).toBe(false);
  });

  it("shows checking, then the last four characters when the server accepts the key", async () => {
    const fetchMock = stubSetup();
    const stubbed = fetchMock.getMockImplementation();
    let release = (): void => undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url !== "/api/connect/api-key") return stubbed?.(url, init) ?? Promise.reject(new Error("no stub"));
      return new Promise((resolve) => {
        release = () => resolve(jsonResponse({ ...NOT_CONNECTED, mode: "api_key", keyLast4: "1234" }));
      });
    });
    renderWithProviders(<SetupRoute />);
    await chooseApiKey();
    await userEvent.type(screen.getByLabelText("API key"), "sk-ant-test-1234");
    await userEvent.click(screen.getByRole("button", { name: "Check key" }));
    expect(await screen.findByText("Checking key…")).toBeInTheDocument();
    release();
    expect(await screen.findByText("Key works · ending in 1234")).toBeInTheDocument();
  });

  it("says Anthropic rejected the key when the server answers key_rejected", async () => {
    stubSetup(NOT_CONNECTED, {
      "POST /api/connect/api-key": () => jsonResponse({ error: "Anthropic rejected this key", code: "key_rejected" }, 400),
    });
    renderWithProviders(<SetupRoute />);
    await chooseApiKey();
    await userEvent.type(screen.getByLabelText("API key"), "sk-ant-bad");
    await userEvent.click(screen.getByRole("button", { name: "Check key" }));
    expect(await screen.findByText(/Anthropic rejected this key\. Copy it again/)).toBeInTheDocument();
  });

  it("checks a cloud profile for the chosen provider", async () => {
    const fetchMock = stubSetup(NOT_CONNECTED, {
      "POST /api/connect/cloud": () => jsonResponse({ ...NOT_CONNECTED, mode: "cloud", provider: "vertex" }),
    });
    renderWithProviders(<SetupRoute />);
    await userEvent.click(await screen.findByRole("radio", { name: /Use my cloud provider/ }));
    await userEvent.selectOptions(screen.getByLabelText("Provider"), "vertex");
    await userEvent.type(screen.getByLabelText("Region"), "us-east5");
    await userEvent.type(screen.getByLabelText("Google Cloud project ID"), "studio-edits");
    await userEvent.click(screen.getByRole("button", { name: "Check profile" }));
    expect(await screen.findByText("Profile works · Vertex AI")).toBeInTheDocument();
    expect(requestBody(fetchMock, "/api/connect/cloud")).toEqual({
      provider: "vertex",
      values: { CLOUD_ML_REGION: "us-east5", ANTHROPIC_VERTEX_PROJECT_ID: "studio-edits" },
    });
  });

  it("sends the Bedrock region and leaves an empty optional profile out", async () => {
    const fetchMock = stubSetup(NOT_CONNECTED, {
      "POST /api/connect/cloud": () => jsonResponse({ ...NOT_CONNECTED, mode: "cloud", provider: "bedrock" }),
    });
    renderWithProviders(<SetupRoute />);
    await userEvent.click(await screen.findByRole("radio", { name: /Use my cloud provider/ }));
    expect(screen.getByLabelText("AWS profile (optional)")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("AWS region"), " us-west-2 ");
    await userEvent.click(screen.getByRole("button", { name: "Check profile" }));
    expect(await screen.findByText("Profile works · Amazon Bedrock")).toBeInTheDocument();
    expect(requestBody(fetchMock, "/api/connect/cloud")).toEqual({ provider: "bedrock", values: { AWS_REGION: "us-west-2" } });
  });

  it("enables terminal mode only after the disclosure tick and shows the detected version", async () => {
    const fetchMock = stubSetup(NOT_CONNECTED, {
      "POST /api/connect/terminal": () => jsonResponse({ ...NOT_CONNECTED, mode: "terminal" }),
    });
    renderWithProviders(<SetupRoute />);
    await userEvent.click(await screen.findByRole("radio", { name: /Use Claude Code in a terminal/ }));
    expect(screen.getByText("Claude Code 2.1.300 found on this computer.")).toBeInTheDocument();
    const useTerminal = screen.getByRole("button", { name: "Use terminal mode" });
    expect(useTerminal).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await userEvent.click(useTerminal);
    expect(await screen.findByText("Terminal mode is on.")).toBeInTheDocument();
    expect(requestBody(fetchMock, "/api/connect/terminal")).toEqual({ hasAcceptedDisclosure: true });
  });

  it("links the terminal disclosure to the legal page, the Agent SDK overview and the help article", async () => {
    stubSetup(NOT_CONNECTED);
    renderWithProviders(<SetupRoute />);
    await userEvent.click(await screen.findByRole("radio", { name: /Use Claude Code in a terminal/ }));
    expect(screen.getByRole("link", { name: /legal and compliance/ })).toHaveAttribute("href", "https://code.claude.com/docs/en/legal-and-compliance");
    expect(screen.getByRole("link", { name: /Agent SDK overview/ })).toHaveAttribute("href", "https://code.claude.com/docs/en/agent-sdk/overview");
    expect(screen.getByRole("link", { name: /with your Claude plan/ })).toHaveAttribute(
      "href",
      "https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan",
    );
  });

  it("flags a Claude Code older than the minimum with the install link", async () => {
    stubSetup({ ...NOT_CONNECTED, claudeVersion: "2.1.12" });
    renderWithProviders(<SetupRoute />);
    await userEvent.click(await screen.findByRole("radio", { name: /Use Claude Code in a terminal/ }));
    expect(screen.getByText(/Claude Code 2\.1\.12 is older than 2\.1\.295/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Update Claude Code/ })).toHaveAttribute("href", "https://code.claude.com/docs/en/setup");
  });

  it("lists the machine checks with their one-line fixes and the read-only data backend", async () => {
    stubSetup();
    renderWithProviders(<SetupRoute />);
    const table = await screen.findByRole("table", { name: "This computer" });
    expect(await within(table).findByText("Fix: Install Google Chrome")).toBeInTheDocument();
    expect(within(table).getByText("Embedded database (PGlite) · switch in README (DATABASE_URL)")).toBeInTheDocument();
    expect(within(table).getAllByRole("rowheader", { name: "Data backend" })).toHaveLength(1);
    expect(within(table).queryAllByRole("textbox")).toEqual([]);
  });

  it("names the Postgres backend the server runs on, not the embedded database", async () => {
    const postgres: DoctorCheck = { id: "database", label: "Data backend", status: "pass", detail: "Postgres at 127.0.0.1:45322" };
    stubSetup(NOT_CONNECTED, { "GET /api/doctor": () => jsonResponse({ checks: withDatabase(postgres) }) });
    renderWithProviders(<SetupRoute />);

    const row = await dataBackendRow();
    expect(await within(row).findByText("Postgres at 127.0.0.1:45322 · switch in README (DATABASE_URL)")).toBeInTheDocument();
    expect(within(row).getByText("OK")).toBeInTheDocument();
    expect(screen.queryByText(/Embedded database/)).not.toBeInTheDocument();
  });

  it("shows a failing data backend as Fix needed, not Missing, with its fix", async () => {
    const exposed: DoctorCheck = {
      id: "database",
      label: "Data backend",
      status: "fail",
      detail: "Postgres at 127.0.0.1:45322, but port 45322 answers on 192.0.2.10",
      fix: "Publish Postgres on 127.0.0.1:45322 only",
    };
    stubSetup(NOT_CONNECTED, { "GET /api/doctor": () => jsonResponse({ checks: withDatabase(exposed) }) });
    renderWithProviders(<SetupRoute />);

    const row = await dataBackendRow();
    expect(await within(row).findByText("Fix needed")).toBeInTheDocument();
    expect(within(row).queryByText("Missing")).not.toBeInTheDocument();
    expect(within(row).getByText("Fix: Publish Postgres on 127.0.0.1:45322 only")).toBeInTheDocument();
  });

  it("claims no backend while the checks are still running", async () => {
    const answer = stubSetup();
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => (url === "/api/doctor" ? new Promise(() => {}) : answer(url, init)));
    renderWithProviders(<SetupRoute />);

    const row = await dataBackendRow();
    expect(within(row).getByText("switch in README (DATABASE_URL)")).toBeInTheDocument();
    expect(screen.queryByText(/Embedded database/)).not.toBeInTheDocument();
  });

  it("gates Continue until Claude is connected", async () => {
    stubSetup({ ...NOT_CONNECTED, mode: "api_key", keyLast4: "9876" });
    renderWithProviders(<SetupRoute />);
    expect(await screen.findByRole("link", { name: "Continue" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Key works · ending in 9876")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    stubSetup();
    const { container } = renderWithProviders(<SetupRoute />);
    await screen.findByText("Fix: Install Google Chrome");
    const results = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
