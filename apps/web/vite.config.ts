// Created by The Angelo Umali.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { APP_PORT, LOOPBACK_HOST } from "@zks/shared";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
