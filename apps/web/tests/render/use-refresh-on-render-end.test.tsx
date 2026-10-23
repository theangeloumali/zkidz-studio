// Created by The Angelo Umali.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderQueryKeys } from "../../src/render/render-api.ts";
import { useRefreshOnRenderEnd } from "../../src/render/use-refresh-on-render-end.ts";
import { PROJECT_ID } from "../fakes.ts";

function renderRefreshHook(initiallyRendering: boolean) {
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const hook = renderHook(({ isRendering }) => useRefreshOnRenderEnd(PROJECT_ID, isRendering), { wrapper, initialProps: { isRendering: initiallyRendering } });
  return { hook, invalidateQueries };
}

describe("useRefreshOnRenderEnd", () => {
  it("refetches deliverables and checks once when the last job stops, since their polling stops with it", () => {
    const { hook, invalidateQueries } = renderRefreshHook(true);

    hook.rerender({ isRendering: false });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: renderQueryKeys.deliverables(PROJECT_ID) });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: renderQueryKeys.qc(PROJECT_ID) });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("does nothing on mount or while a render keeps going", () => {
    const { hook, invalidateQueries } = renderRefreshHook(false);

    hook.rerender({ isRendering: true });
    hook.rerender({ isRendering: true });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
