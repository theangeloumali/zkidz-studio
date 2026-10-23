// Created by The Angelo Umali.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { API_ROUTES, RULE_TEXT_MAX_CHARS, type Rule } from "@zks/shared";
import { RulesRoute } from "../../src/rules/rules-route.tsx";
import { jsonResponse } from "../fakes.ts";
import { renderWithProviders, requestBody, stubFetch } from "../render.tsx";

const LIST_KEY = `GET ${API_ROUTES.listRules.path}`;
const CREATE_KEY = `POST ${API_ROUTES.createRule.path}`;
const RULE_ID = "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f";

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: RULE_ID,
    text: "Keep every hook title under six words.",
    sourceQuote: null,
    isEnabled: true,
    createdAt: "2026-10-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("Rules panel", () => {
  it("numbers each rule and labels its delete button", async () => {
    stubFetch({
      [LIST_KEY]: () => jsonResponse({ rules: [makeRule(), makeRule({ id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", text: "Never blur my family." })] }),
    });
    renderWithProviders(<RulesRoute />);

    const list = await screen.findByRole("list", { name: "Your rules" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[1] as HTMLElement).getByText("Never blur my family.")).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByRole("button", { name: "Delete rule 2" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no rules", async () => {
    stubFetch({ [LIST_KEY]: () => jsonResponse({ rules: [] }) });
    renderWithProviders(<RulesRoute />);

    expect(await screen.findByText("No rules yet")).toBeInTheDocument();
  });

  it("counts characters and caps the field at the rule limit", async () => {
    stubFetch({ [LIST_KEY]: () => jsonResponse({ rules: [] }) });
    renderWithProviders(<RulesRoute />);

    const field = screen.getByRole("textbox", { name: "New rule" });
    expect(field).toHaveAttribute("maxlength", String(RULE_TEXT_MAX_CHARS));
    await userEvent.type(field, "Short");
    expect(screen.getByText(`5 / ${RULE_TEXT_MAX_CHARS}`)).toBeInTheDocument();
  });

  it("adds a rule only on an explicit click and announces it", async () => {
    let rules: Rule[] = [];
    const fetchMock = stubFetch({
      [LIST_KEY]: () => jsonResponse({ rules }),
      [CREATE_KEY]: () => {
        rules = [makeRule()];
        return jsonResponse(makeRule(), 201);
      },
    });
    renderWithProviders(<RulesRoute />);
    await screen.findByText("No rules yet");

    await userEvent.type(screen.getByRole("textbox", { name: "New rule" }), "  Keep every hook title under six words.  ");
    await userEvent.click(screen.getByRole("button", { name: "Add rule" }));

    expect(await screen.findByText("Rule added. Applies from the next session.")).toBeInTheDocument();
    expect(screen.getByText(/Standing instructions for your edits\. Applies from the next session\.$/)).toBeInTheDocument();
    expect(requestBody(fetchMock, API_ROUTES.createRule.path, "POST")).toEqual({ text: "Keep every hook title under six words." });
    expect(await screen.findByRole("button", { name: "Delete rule 1" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New rule" })).toHaveValue("");
  });

  it("sends nothing for a blank rule", async () => {
    const fetchMock = stubFetch({ [LIST_KEY]: () => jsonResponse({ rules: [] }) });
    renderWithProviders(<RulesRoute />);
    await screen.findByText("No rules yet");

    await userEvent.type(screen.getByRole("textbox", { name: "New rule" }), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Add rule" }));

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(screen.getByRole("textbox", { name: "New rule" })).toHaveFocus();
  });

  it("deletes a rule and announces it", async () => {
    let rules: Rule[] = [makeRule()];
    stubFetch({
      [LIST_KEY]: () => jsonResponse({ rules }),
      [`DELETE /api/rules/${RULE_ID}`]: () => {
        rules = [];
        return jsonResponse({ ok: true });
      },
    });
    renderWithProviders(<RulesRoute />);

    await userEvent.click(await screen.findByRole("button", { name: "Delete rule 1" }));

    expect(await screen.findByText("Rule deleted.")).toBeInTheDocument();
    expect(await screen.findByText("No rules yet")).toBeInTheDocument();
  });

  it("shows the server's reason when a save fails", async () => {
    stubFetch({ [LIST_KEY]: () => jsonResponse({ rules: [] }), [CREATE_KEY]: () => jsonResponse({ error: "Rules are capped at 500 characters" }, 400) });
    renderWithProviders(<RulesRoute />);
    await screen.findByText("No rules yet");

    await userEvent.type(screen.getByRole("textbox", { name: "New rule" }), "Too long");
    await userEvent.click(screen.getByRole("button", { name: "Add rule" }));

    expect(await screen.findByText("Rules are capped at 500 characters")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New rule" })).toHaveValue("Too long");
  });

  it("has no axe violations", async () => {
    stubFetch({ [LIST_KEY]: () => jsonResponse({ rules: [makeRule()] }) });
    const { container } = renderWithProviders(<RulesRoute />);
    await screen.findByRole("button", { name: "Delete rule 1" });

    const results = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
