// Created by The Angelo Umali.
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// Agent text (cues, captions, narration, tool labels) can carry injected markup, so raw HTML sinks are banned (plan §9.1).
const HTML_SINK_MESSAGE = "Raw HTML sinks are banned: render agent text as React text nodes (plan §9.1).";
const htmlSinkProperties = ["innerHTML", "outerHTML", "insertAdjacentHTML"].map((property) => ({ property, message: HTML_SINK_MESSAGE }));

// The overlay renderer's Node side (CommonJS, run by node and the engine).
const RENDERER_NODE_GLOBALS = [
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "Buffer",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
];
const RENDERER_PLATFORM_GLOBALS = ["structuredClone", "URLSearchParams", "TextDecoder", "TextEncoder", "AbortController", "AbortSignal", "performance"];

export default defineConfig(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "design/mockup/",
      "packages/shared/schema/",
      // Page scripts the render page loads by <script> tag; they share globals across files (BRAND, ctx, TYPE), which per-file lint cannot see.
      "packages/engine/hf/kit/",
      "packages/engine/hf/overlay/",
      "packages/engine/hf/components/",
      "packages/engine/hf/fx/",
      "packages/engine/hf/preview/player.js",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,jsx}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { console: "readonly", process: "readonly", URL: "readonly" } },
  },
  {
    files: ["packages/engine/hf/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: Object.fromEntries([...RENDERER_NODE_GLOBALS, ...RENDERER_PLATFORM_GLOBALS].map((name) => [name, "readonly"])),
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-restricted-properties": ["error", ...htmlSinkProperties],
      "no-restricted-syntax": [
        "error",
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: HTML_SINK_MESSAGE },
        { selector: "Property[key.name='dangerouslySetInnerHTML']", message: HTML_SINK_MESSAGE },
      ],
    },
  },
);
