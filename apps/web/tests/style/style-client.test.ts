// Created by The Angelo Umali.
import { API_ROUTES } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { fetchProjectStyle, projectStyleQuery, saveProjectStyle } from "../../src/style/style-client.ts";
import { PROJECT_ID, jsonResponse } from "../fakes.ts";
import { requestBody, stubFetch } from "../render.tsx";

const STYLE_PATH = `/api/projects/${PROJECT_ID}/style`;

describe("style client", () => {
  it("reads the project's style, null when none is set", async () => {
    stubFetch({ [`GET ${STYLE_PATH}`]: () => jsonResponse({ style: null }) });

    await expect(fetchProjectStyle(PROJECT_ID)).resolves.toBeNull();
  });

  it("PUTs the style under the route's body shape", async () => {
    const fetchMock = stubFetch({ [`${API_ROUTES.setProjectStyle.method} ${STYLE_PATH}`]: () => jsonResponse({ style: { theme: "minimal" } }) });

    await expect(saveProjectStyle(PROJECT_ID, { theme: "minimal" })).resolves.toEqual({ theme: "minimal" });
    expect(requestBody(fetchMock, STYLE_PATH, "PUT")).toEqual({ style: { theme: "minimal" } });
  });

  it("PUTs null to reset to the shipped theme", async () => {
    const fetchMock = stubFetch({ [`PUT ${STYLE_PATH}`]: () => jsonResponse({ style: null }) });

    await expect(saveProjectStyle(PROJECT_ID, null)).resolves.toBeNull();
    expect(requestBody(fetchMock, STYLE_PATH, "PUT")).toEqual({ style: null });
  });

  it("keys the query per project so one project's look never shows on another", () => {
    expect(projectStyleQuery("a").queryKey).not.toEqual(projectStyleQuery("b").queryKey);
  });
});
