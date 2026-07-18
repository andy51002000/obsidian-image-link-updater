import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: [path.resolve(__dirname, "specs/**/*.e2e.ts")],

  // One instance at a time; each spec opens a fresh vault copy via reloadObsidian
  maxInstances: 1,

  capabilities: [
    {
      browserName: "obsidian",
      // Download Obsidian 1.9.14 — wdio-obsidian-service fetches a compatible ChromeDriver.
      browserVersion: "1.9.14",
      "wdio:obsidianOptions": {
        installerVersion: "latest",
        // Install this plugin from the repo root (main.js + manifest.json)
        plugins: [repoRoot],
        // Default vault for the initial Obsidian launch.
        // Tests reload with vault-minimal (lean) or vault-fixture as needed.
        vault: path.resolve(__dirname, "vault-minimal"),
      },
    },
  ],

  services: ["obsidian"],
  reporters: ["spec"],

  // Downloaded Obsidian versions are cached here so subsequent runs are fast.
  cacheDir: path.resolve(repoRoot, ".obsidian-cache"),

  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },

  waitforTimeout: 60000,
  connectionRetryTimeout: 120000,

  /**
   * Increase the WebDriver script timeout after session is created.
   * Default is 30s; the plugin's vault-wide link update (iterates all md files)
   * can take longer for larger vaults.
   */
  async before() {
    await browser.setTimeout({ script: 90000 });
  },

  logLevel: "warn",
};
