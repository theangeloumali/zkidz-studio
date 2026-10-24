// Created by The Angelo Umali.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { APP_PORT, LOOPBACK_HOST } from "@zks/shared";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The CSP is font-src 'self'; Vite would inline the <4 KB cyrillic-ext woff2 as a data: URL, which it blocks.
    assetsInlineLimit: (filePath) => (/\.woff2?$/.test(filePath) ? false : undefined),
  },
  server: {
    host: LOOPBACK_HOST,
    proxy: { "/api": { target: `http://${LOOPBACK_HOST}:${APP_PORT}`, ws: true } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    css: false,
    // A fresh jsdom per file costs up to 61 s over the 9p mount under ci:local load; sharing forks pays it once per worker.
    // Shuffled single-fork runs showed no state leaking between files.
    isolate: false,
    // Playwright owns e2e/; vitest would run its specs under jsdom.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
