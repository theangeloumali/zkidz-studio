// Created by The Angelo Umali.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
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
  },
});
