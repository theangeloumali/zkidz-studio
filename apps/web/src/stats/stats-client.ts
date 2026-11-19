// Created by The Angelo Umali.
import { queryOptions } from "@tanstack/react-query";
import { API_ROUTES, type StatsRange } from "@zks/shared";
import { requestJson } from "../api/client.ts";

const { getStats } = API_ROUTES;

export const statsQuery = (range: StatsRange) =>
  queryOptions({
    queryKey: ["stats", range] as const,
    queryFn: () => requestJson(getStats.response, `${getStats.path}?${new URLSearchParams({ range }).toString()}`),
  });
