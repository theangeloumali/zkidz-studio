// Created by The Angelo Umali.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_ROUTES } from "@zks/shared";
import { StyleRoute } from "../../src/onboarding/style-route.tsx";
import { SAMPLE_MS } from "../../src/onboarding/style-sample.tsx";
import { jsonResponse } from "../fakes.ts";
import { renderWithProviders, requestBody, stubFetch } from "../render.tsx";
import { SHIPPED_STYLES } from "../shipped-presets.ts";

const GET_KEY = `GET ${API_ROUTES.getStyle.path}`;
const PUT_KEY = `PUT ${API_ROUTES.setStyle.path}`;
const PRESETS_KEY = `GET ${API_ROUTES.listStylePresets.path}`;
const listPresets = () => jsonResponse({ styles: SHIPPED_STYLES });

function renderStyleRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/setup/style" element={<StyleRoute />} />
      <Route path="/" element={<p>Home page</p>} />
    </Routes>,
    "/setup/style",
  );
}

function sampleOf(styleName: string): HTMLElement {
  return screen.getByRole("figure", { name: `${styleName} sample` });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Pick a style", () => {
  it("offers every shipped style and preselects the saved one", async () => {
    stubFetch({ [PRESETS_KEY]: listPresets, [GET_KEY]: () => jsonResponse({ styleId: "plain" }) });
    renderStyleRoute();

    const group = screen.getByRole("group", { name: "Styles" });
    const radios = await within(group).findAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("value")).sort()).toEqual(SHIPPED_STYLES.map((style) => style.id).sort());
    await waitFor(() => expect(screen.getByRole("radio", { name: /Plain/ })).toBeChecked());
    expect(screen.getByRole("radio", { name: /ZKidz/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Loud/ })).not.toBeChecked();
  });

  it("falls back to the ZKidz style when none is saved yet", async () => {
    stubFetch({ [PRESETS_KEY]: listPresets, [GET_KEY]: () => jsonResponse({ error: "Not found" }, 404) });
    renderStyleRoute();

    expect(await screen.findByRole("radio", { name: /ZKidz/ })).toBeChecked();
  });

  it("draws each card's sample from that preset's cue sheet", async () => {
    stubFetch({ [PRESETS_KEY]: listPresets, [GET_KEY]: () => jsonResponse({ styleId: "zkidz" }) });
    renderStyleRoute();
    await screen.findByRole("radio", { name: /Loud/ });

    const loud = sampleOf("Loud");
    expect(loud).toHaveTextContent("WAIT");
    expect(loud).toHaveTextContent("YES");
    expect(loud).toHaveTextContent("Big words, every beat.");
    expect(loud.querySelector(".style-sample-gold")).toHaveTextContent("WAIT");
    expect(sampleOf("ZKidz").querySelector(".style-sample-kicker")).toHaveTextContent("NEW SETUP");
    expect(sampleOf("ZKidz").querySelector(".style-sample-gold")).toHaveTextContent("edit this");
    expect(sampleOf("Plain").querySelector(".style-sample-hook")).toBeNull();
  });

  it("says why the styles could not load", async () => {
    stubFetch({ [PRESETS_KEY]: () => jsonResponse({ error: "Presets are unreadable" }, 500), [GET_KEY]: () => jsonResponse({ styleId: "zkidz" }) });
    renderStyleRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("Presets are unreadable");
  });

  it("plays a 5 second sample when replayed, then marks it done", async () => {
    stubFetch({ [PRESETS_KEY]: listPresets, [GET_KEY]: () => jsonResponse({ styleId: "zkidz" }) });
    renderStyleRoute();
    await screen.findByRole("button", { name: "Play the Loud sample" });
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Play the Loud sample" }));
    expect(sampleOf("Loud")).toHaveAttribute("data-playing", "true");

    act(() => {
      vi.advanceTimersByTime(SAMPLE_MS - 1);
    });
    expect(sampleOf("Loud")).toHaveAttribute("data-playing", "true");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sampleOf("Loud")).toHaveAttribute("data-playing", "done");
    expect(SAMPLE_MS).toBe(5000);
  });

  it("replays a card's sample when that card is picked", async () => {
    stubFetch({ [PRESETS_KEY]: listPresets, [GET_KEY]: () => jsonResponse({ styleId: "zkidz" }) });
    renderStyleRoute();

    await userEvent.click(await screen.findByRole("radio", { name: /Plain/ }));
    expect(sampleOf("Plain")).toHaveAttribute("data-playing", "true");
  });

  it("saves the chosen style and returns home", async () => {
    const fetchMock = stubFetch({
      [PRESETS_KEY]: listPresets,
      [GET_KEY]: () => jsonResponse({ styleId: "zkidz" }),
      [PUT_KEY]: () => jsonResponse({ styleId: "loud" }),
    });
    renderStyleRoute();

    await userEvent.click(await screen.findByRole("radio", { name: /Loud/ }));
    await userEvent.click(screen.getByRole("button", { name: "Use this style" }));

    expect(await screen.findByText("Home page")).toBeInTheDocument();
    expect(requestBody(fetchMock, API_ROUTES.setStyle.path, "PUT")).toEqual({ styleId: "loud" });
  });

  it("keeps the user on the page with the reason when saving fails", async () => {
    stubFetch({
      [PRESETS_KEY]: listPresets,
      [GET_KEY]: () => jsonResponse({ styleId: "zkidz" }),
      [PUT_KEY]: () => jsonResponse({ error: "Style store is read-only" }, 500),
    });
    renderStyleRoute();

    await userEvent.click(await screen.findByRole("button", { name: "Use this style" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Style store is read-only");
  });

  it("has no axe violations", async () => {
    stubFetch({ [PRESETS_KEY]: listPresets, [GET_KEY]: () => jsonResponse({ styleId: "zkidz" }) });
    const { container } = renderStyleRoute();
    await screen.findByRole("radio", { name: /ZKidz/ });

    const results = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
