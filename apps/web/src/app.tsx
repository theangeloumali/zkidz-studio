// Created by The Angelo Umali.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ROUTE_PATHS } from "./lib/routes.ts";
import { AppShell } from "./routes/app-shell.tsx";
import { HomeRoute } from "./routes/home.tsx";
import { SetupRoute } from "./routes/setup.tsx";
import { StyleRoute } from "./onboarding/style-route.tsx";
import { RulesRoute } from "./rules/rules-route.tsx";

// The SSE stream invalidates what changes, so polling-style refetches would only duplicate it.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } });

// The editor (timeline, preview, terminal) and render pages load on first visit, keeping them out of the initial bundle.
const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: ROUTE_PATHS.home, element: <HomeRoute /> },
      { path: ROUTE_PATHS.setup, element: <SetupRoute /> },
      { path: ROUTE_PATHS.editor, lazy: async () => ({ Component: (await import("./routes/editor.tsx")).EditorRoute }) },
      { path: ROUTE_PATHS.render, lazy: async () => ({ Component: (await import("./routes/render.tsx")).RenderRoute }) },
      { path: ROUTE_PATHS.rules, element: <RulesRoute /> },
      { path: ROUTE_PATHS.style, element: <StyleRoute /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
