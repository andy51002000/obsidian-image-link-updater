import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default [
  {
    ignores: [
      // Build artifacts, not source.
      "main.js",
      "dist/**",
      "release/**",
      // Node-side tooling, not plugin code shipped to users.
      "scripts/**",
      "rollup.config.js",
      // wdio.conf.mts is tooling config outside the tsconfig project, so
      // typed-lint rules cannot run on it.
      "e2e/wdio.conf.mts",
      "eslint.config.mjs",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["main.ts", "src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
  },
  {
    // E2E tests run in the wdio/mocha environment — Mocha globals are not in scope
    // for the main plugin source, so they get their own config block.
    files: ["e2e/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.mocha,
        ...globals.browser,
        // Chai's expect is injected by wdio-mocha-framework at runtime
        expect: "readonly",
      },
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
  },
];
