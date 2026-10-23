// Created by The Angelo Umali.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";

export function renderWithProviders(ui: ReactElement, route = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

type Handler = (init: RequestInit | undefined) => Response;

/** Stubs fetch with handlers keyed "METHOD /path"; an unknown request fails the test loudly. */
export function stubFetch(handlers: Readonly<Record<string, Handler>>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = handlers[key];
    if (!handler) return Promise.reject(new Error(`Unexpected request: ${key}`));
    return Promise.resolve(handler(init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The parsed JSON body of the first stubbed request to `url`. */
/** Pass `method` when a GET shares the url, or the GET's empty body is found first. */
export function requestBody(fetchMock: ReturnType<typeof stubFetch>, url: string, method?: string): unknown {
  const body = fetchMock.mock.calls.find(([calledUrl, init]) => calledUrl === url && (method === undefined || init?.method === method))?.[1]?.body;
  if (typeof body !== "string") throw new Error(`No JSON body was sent to ${url}`);
  return JSON.parse(body);
}
