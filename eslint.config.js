// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  // ESLint covers the application and its tooling config, and nothing else.
  // Everything outside that is the Blueprint delivery harness (scripts/,
  // hooks/, .claude/, .github/, docs/, website/, ...), which keeps its own
  // conventions and gates: `make lint` must never report on it, and
  // `eslint --fix` must never rewrite it. Same allowlist as .prettierignore:
  // ignore every top-level entry, then re-include the application trees and
  // the root config files by name.
  globalIgnores([
    "*",
    "!packages/",
    "!apps/",
    "!*.config.js",
    "!*.config.ts",
    "**/dist/",
    "**/coverage/",
    "**/playwright-report/",
    "**/test-results/",
    "**/blob-report/",
  ]),
  {
    files: ["**/*.{js,ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The packages' `./testing` exports (a workbook writer, the XSD check)
    // resolve under the `source` condition, which the web build also sets:
    // imported from application code they would ship in the bundle. Tests
    // and the test helpers themselves may use them.
    files: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "**/testing/**", "packages/*/test/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@taxreporter/*/testing",
                "@taxreporter/*/testing/*",
                "./testing/*",
                "../testing/*",
                "../../testing/*",
              ],
              message:
                "Test helpers only: import them from a *.test.ts file, never from application code.",
            },
          ],
        },
      ],
    },
  },
);
