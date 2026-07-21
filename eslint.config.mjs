import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default [
  ...obsidianmd.configs.recommended,
  {
    files: ["main.ts", "src/**/*.ts"],
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
