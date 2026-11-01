// Created by The Angelo Umali.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API_ROUTES } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { LessonsCard } from "../src/agent/lessons-card.tsx";
import { sampleEvent } from "./event-fixtures.ts";
import { jsonResponse } from "./fakes.ts";
import { renderWithProviders, requestBody, stubFetch } from "./render.tsx";

const CREATE_KEY = `POST ${API_ROUTES.createRule.path}`;
// The client reads its CSRF token from a GET before its first write.
const TOKEN_KEY = `GET ${API_ROUTES.listProjects.path}`;
const tokenResponse = () => jsonResponse({ projects: [] });
const savedRule = (text: string) => ({
  id: crypto.randomUUID(),
  text,
  sourceQuote: "Suggested after an edit",
  isEnabled: true,
  createdAt: "2026-10-31T10:00:00.000Z",
});

describe("LessonsCard", () => {
  it("saves a lesson as a rule with one click, marked as suggested after an edit", async () => {
    const fetchMock = stubFetch({ [TOKEN_KEY]: tokenResponse, [CREATE_KEY]: () => jsonResponse(savedRule("Open on the result, not the setup."), 201) });
    renderWithProviders(<LessonsCard event={sampleEvent("lessons.suggested")} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved as a rule")).toBeInTheDocument();
    expect(requestBody(fetchMock, API_ROUTES.createRule.path, "POST")).toEqual({
      text: "Open on the result, not the setup.",
      sourceQuote: "Suggested after an edit",
    });
  });

  it("says why when a lesson is not saved, and keeps its Save button", async () => {
    stubFetch({ [TOKEN_KEY]: tokenResponse, [CREATE_KEY]: () => jsonResponse({ error: "Rule text is too long" }, 400) });
    renderWithProviders(<LessonsCard event={sampleEvent("lessons.suggested")} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: Rule text is too long");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps two suggestions with the same text as separate rows", async () => {
    stubFetch({ [TOKEN_KEY]: tokenResponse, [CREATE_KEY]: () => jsonResponse(savedRule("Cut the pause."), 201) });
    renderWithProviders(<LessonsCard event={sampleEvent("lessons.suggested", { lessons: ["Cut the pause.", "Cut the pause."] })} />);
    const [first, second] = screen.getAllByRole("listitem");
    if (first === undefined || second === undefined) throw new Error("expected two lesson rows");

    await userEvent.click(within(first).getByRole("button", { name: "Save" }));

    expect(await within(first).findByText("Saved as a rule")).toBeInTheDocument();
    expect(within(second).getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
