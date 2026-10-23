// Created by The Angelo Umali.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ROUTE_PATHS } from "./lib/routes.ts";
import { AppShell } from "./routes/app-shell.tsx";
import { EditorRoute } from "./routes/editor.tsx";
import { HomeRoute } from "./routes/home.tsx";
import { RenderRoute } from "./routes/render.tsx";
import { SetupRoute } from "./routes/setup.tsx";

// The SSE stream invalidates what changes, so polling-style refetches would only duplicate it.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: ROUTE_PATHS.home, element: <HomeRoute /> },
      { path: ROUTE_PATHS.setup, element: <SetupRoute /> },
      { path: ROUTE_PATHS.editor, element: <EditorRoute /> },
      { path: ROUTE_PATHS.render, element: <RenderRoute /> },
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
