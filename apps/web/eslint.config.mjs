// Created by The Angelo Umali.
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import rootConfig from "../../eslint.config.mjs";

export default defineConfig(
  rootConfig,
  {
    // One project service per lint run: playwright.config.ts sits beside the app's tsconfig, so the e2e one types it.
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["playwright.config.ts"], defaultProject: "e2e/tsconfig.json" },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ["**/*.{js,mjs,cjs,jsx}"], languageOptions: { parserOptions: { projectService: false } } },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat["recommended-latest"], jsxA11y.flatConfigs.recommended],
    // The shadcn controls in src/components/ui render native-backed inputs, so a <label> around one is associated.
    rules: {
      "jsx-a11y/label-has-associated-control": ["error", { controlComponents: ["Checkbox", "RadioGroupItem", "Input", "Textarea", "Switch"], depth: 3 }],
    },
  },
);
