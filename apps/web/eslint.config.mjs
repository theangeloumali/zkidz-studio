// Created by The Angelo Umali.
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import rootConfig from "../../eslint.config.mjs";

export default defineConfig(
  rootConfig,
  {
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat["recommended-latest"], jsxA11y.flatConfigs.recommended],
  },
);
