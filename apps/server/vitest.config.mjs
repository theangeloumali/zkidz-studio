// Created by The Angelo Umali.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Most files boot a PGlite in a hook: CPU-bound WASM initdb + migrate, ~3-5 s idle and 22-37 s under a loaded machine.
    hookTimeout: 60_000,
  },
});
