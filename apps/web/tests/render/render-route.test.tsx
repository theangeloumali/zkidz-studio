// Created by The Angelo Umali.
import { CSRF_HEADER } from "@zks/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTE_PATHS, renderPath } from "../../src/lib/routes.ts";
import { RenderRoute } from "../../src/routes/render.tsx";
import { FakeEventSource, PROJECT_ID, TEST_CSRF_TOKEN, jsonResponse, makeProject } from "../fakes.ts";
import { renderWithProviders, requestBody, stubFetch } from "../render.tsx";
import { CPU_HARDWARE, FULL_HASH, NVIDIA_HARDWARE, QC_CHECKS, makeDeliverable, makeJob } from "./fixtures.ts";

const BASE = `/api/projects/${PROJECT_ID}`;

interface ServerState {
  readonly jobs?: unknown[];
  readonly deliverables?: unknown[];
  readonly hardware?: Response;
}

function stubServer({ jobs = [makeJob()], deliverables = [makeDeliverable()], hardware = jsonResponse(NVIDIA_HARDWARE) }: ServerState = {}) {
  return stubFetch({
    [`GET ${BASE}`]: () => jsonResponse(makeProject()),
    [`GET ${BASE}/jobs`]: () => jsonResponse({ jobs }),
    [`GET ${BASE}/deliverables`]: () => jsonResponse({ deliverables }),
    [`GET ${BASE}/qc`]: () => jsonResponse({ checks: QC_CHECKS }),
    "GET /api/hardware": () => hardware,
    [`POST ${BASE}/reveal`]: () => jsonResponse({ ok: true }),
    [`POST ${BASE}/prompt`]: () => jsonResponse({ ok: true }),
  });
}

function renderScreen() {
  return renderWithProviders(
    <Routes>
      <Route path={ROUTE_PATHS.render} element={<RenderRoute />} />
    </Routes>,
    renderPath(PROJECT_ID),
  );
}

describe("Render & export screen", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  it("shows each job with its backend chip, percent and ETA, and its stages", async () => {
    stubServer();
    renderScreen();

    const queue = await screen.findByRole("region", { name: "Queue" });
    const job = await within(queue).findByRole("listitem", { name: /Full edit/ });
    expect(within(job).getByText("hevc_nvenc")).toBeInTheDocument();
    expect(within(job).getByText("42% · 3 min left")).toBeInTheDocument();
    expect(within(job).getByRole("progressbar", { name: "Overlay frames" })).toHaveAttribute("aria-valuenow", "42");
    expect(within(job).getByRole("progressbar", { name: "Audio mix" })).toHaveAttribute("aria-valuenow", "100");
    expect(within(queue).getByText("Profile: NVIDIA · hevc_nvenc · 4 chunks")).toBeInTheDocument();
  });

  it("shows a failed job's error as text", async () => {
    stubServer({ jobs: [makeJob({ status: "failed", stage: "master", error: "NVENC session limit reached" })] });
    renderScreen();

    expect(await screen.findByText("NVENC session limit reached")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("points to the Editor when nothing is queued", async () => {
    stubServer({ jobs: [] });
    renderScreen();

    expect(await screen.findByText(/Nothing is rendering/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Editor" })).toHaveAttribute("href", `/p/${PROJECT_ID}`);
  });

  it("draws each hardware meter, and says when one is not in use", async () => {
    stubServer();
    renderScreen();

    expect(await screen.findByRole("meter", { name: "GPU utilization" })).toHaveAttribute("aria-valuenow", "87");
    expect(screen.getByRole("meter", { name: "Encoder utilization" })).toHaveAttribute("aria-valuenow", "64");
    expect(screen.getByText("not used")).toBeInTheDocument();
  });

  it("keeps the screen working when the hardware probe is unavailable", async () => {
    stubServer({ hardware: jsonResponse({ error: "Not found" }, 404) });
    renderScreen();

    expect(await screen.findByText("Hardware stats are unavailable.")).toBeInTheDocument();
    expect(await screen.findByText("gpu")).toBeInTheDocument();
  });

  it("ticks each QC gate by its state", async () => {
    stubServer();
    renderScreen();

    const checks = await screen.findByRole("region", { name: "Checks" });
    expect(await within(checks).findByText("Frame count matches the edit")).toBeInTheDocument();
    expect(within(checks).getByText(/passed/)).toBeInTheDocument();
    expect(within(checks).getByText(/failed/)).toBeInTheDocument();
    expect(within(checks).getByText("Shot 3 is frozen against the source")).toBeInTheDocument();
    expect(within(checks).getByText(/waiting/)).toBeInTheDocument();
  });

  it("lists each deliverable with its size and a short SHA-256 that carries the full hash", async () => {
    stubServer();
    renderScreen();

    const deliverables = await screen.findByRole("region", { name: "Deliverables" });
    expect(await within(deliverables).findByText("beach-day-full-4k.mp4")).toBeInTheDocument();
    expect(within(deliverables).getByText("412 MB")).toBeInTheDocument();
    expect(within(deliverables).getByTitle(FULL_HASH)).toHaveTextContent("sha256 3f9a1c2b…d6e7f8");
  });

  it("asks the server to reveal the folder, sending no body, the CSRF header and a JSON content type", async () => {
    const fetchMock = stubServer();
    renderScreen();

    await userEvent.click(await screen.findByRole("button", { name: "Open folder" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${BASE}/reveal`, expect.objectContaining({ method: "POST" })));
    const revealInit = fetchMock.mock.calls.find(([url]) => url === `${BASE}/reveal`)?.[1];
    expect(revealInit?.body).toBeUndefined();
    expect(new Headers(revealInit?.headers).get(CSRF_HEADER)).toBe(TEST_CSRF_TOKEN);
    expect(new Headers(revealInit?.headers).get("content-type")).toBe("application/json");
  });

  it("hides Open folder until a file exists", async () => {
    stubServer({ deliverables: [] });
    renderScreen();

    expect(await screen.findByText("No files yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open folder" })).not.toBeInTheDocument();
  });

  it("picks the render targets and sends them to the agent, which asks for approval in the Editor", async () => {
    const fetchMock = stubServer();
    renderScreen();

    const picker = await screen.findByRole("group", { name: "Render" });
    for (const name of ["Full edit", "Reels cut", "Covers and caption"]) expect(within(picker).getByRole("checkbox", { name })).toBeChecked();
    await userEvent.click(within(picker).getByRole("checkbox", { name: "Reels cut" }));
    await userEvent.click(within(picker).getByRole("button", { name: "Render selected" }));

    expect(await screen.findByText(/Approve the render in the Editor/)).toBeInTheDocument();
    expect(requestBody(fetchMock, `${BASE}/prompt`)).toEqual({
      text: 'Render and export the full edit, the covers and caption. Render the masters with quality "4k".',
    });
  });

  it("disables Render selected when no target is picked", async () => {
    stubServer();
    renderScreen();

    const picker = await screen.findByRole("group", { name: "Render" });
    for (const name of ["Full edit", "Reels cut", "Covers and caption"]) await userEvent.click(within(picker).getByRole("checkbox", { name }));

    expect(within(picker).getByRole("button", { name: "Render selected" })).toBeDisabled();
  });

  it("offers a 1080p render when no hardware encoder was found", async () => {
    const fetchMock = stubServer({ hardware: jsonResponse(CPU_HARDWARE) });
    renderScreen();

    const queue = await screen.findByRole("region", { name: "Queue" });
    expect(await within(queue).findByText("No hardware encoder found.")).toBeInTheDocument();
    await userEvent.click(within(queue).getByRole("button", { name: "Render 1080p instead" }));

    await waitFor(() =>
      expect(requestBody(fetchMock, `${BASE}/prompt`)).toEqual({
        text: 'Render and export the full edit, the Reels cut, the covers and caption. Render the masters with quality "final" (1080p).',
      }),
    );
  });

  it("shows no CPU notice when a hardware encoder exists", async () => {
    stubServer();
    renderScreen();

    await screen.findByText("Profile: NVIDIA · hevc_nvenc · 4 chunks");
    expect(screen.queryByText("No hardware encoder found.")).not.toBeInTheDocument();
  });

  it("announces a finished render with the file count, the folder and Open folder", async () => {
    stubServer({ jobs: [makeJob({ status: "succeeded", stage: null, pct: 100, etaS: null })] });
    renderScreen();

    const banner = await screen.findByRole("status", { name: "Render finished" });
    expect(banner).toHaveTextContent("1 file in ZKS_HOME/projects/beach-day/deliverables/, each checked by SHA-256 against the render.");
    expect(screen.getAllByRole("button", { name: "Open folder" })).toHaveLength(1);
    expect(within(banner).getByRole("button", { name: "Open folder" })).toBeInTheDocument();
  });

  it("shows no finished banner while a job still renders", async () => {
    stubServer();
    renderScreen();

    await screen.findByText("beach-day-full-4k.mp4");
    expect(screen.queryByText("Render finished")).not.toBeInTheDocument();
  });

  it("keeps Deliverables in the side column with Hardware and Checks", async () => {
    stubServer();
    renderScreen();

    const deliverables = await screen.findByRole("region", { name: "Deliverables" });
    const hardware = screen.getByRole("region", { name: "Hardware" });
    expect(deliverables.parentElement).toBe(hardware.parentElement);
    expect(screen.getByRole("region", { name: "Queue" }).parentElement).not.toBe(hardware.parentElement);
  });

  it("has no axe violations", async () => {
    stubServer();
    const { container } = renderScreen();
    await screen.findByText("beach-day-full-4k.mp4");
    await screen.findByText("Frame count matches the edit");

    const results = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } });

    expect(results.violations).toEqual([]);
  });

  it("has no axe violations with the finished banner and the CPU notice showing", async () => {
    stubServer({ jobs: [makeJob({ status: "succeeded", stage: null })], hardware: jsonResponse(CPU_HARDWARE) });
    const { container } = renderScreen();
    await screen.findByText("Render finished");
    await screen.findByText("No hardware encoder found.");

    const results = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } });

    expect(results.violations).toEqual([]);
  });
});
