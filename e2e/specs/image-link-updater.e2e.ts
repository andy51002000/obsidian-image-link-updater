/**
 * E2E tests for the Image Link Updater plugin (v1.3.11).
 *
 * Architecture:
 *   - Each test uses `browser.reloadObsidian({ vault })` to get a fresh
 *     sandbox copy of `vault-minimal` (lean: 4 PNGs + 4 notes, no copilot/git).
 *   - Renames are triggered FIRE-AND-FORGET inside the renderer: we call
 *     `app.fileManager.renameFile()` without `await` and return immediately.
 *     This avoids the 30s ChromeDriver renderer timeout — `renameFile` triggers
 *     the plugin's `updateImageLinks` which processes all vault files and can
 *     take >30s under test conditions.
 *   - Assertions poll the sandbox disk via Node.js `fs` (outside Obsidian)
 *     until the expected content appears or a timeout fires.
 *
 * SAFETY: The original vault at /Users/andy/Documents/Obsidian Vault is NEVER
 * opened. Every test operates on a temporary sandbox copy managed by
 * wdio-obsidian-service.
 */

import { browser } from "@wdio/globals";
import { FileSystemAdapter } from "obsidian";
import { setTimeout as delay } from "node:timers/promises";
import * as fs from "fs";
import * as path from "path";

// Minimal vault: 4 test PNGs + 4 notes + the "english-class" fixture from the
// original vault. The vault has no copilot/git plugins (removed from the fixture).
const FIXTURE_VAULT = path.resolve(__dirname, "../vault-minimal");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the sandbox vault's absolute path on disk. */
async function getCurrentVaultPath(): Promise<string> {
  return browser.executeObsidian(
    ({ app }) => (app.vault.adapter as FileSystemAdapter).getBasePath()
  );
}

/**
 * Trigger a vault rename FIRE-AND-FORGET (no await inside the renderer).
 *
 * `app.fileManager.renameFile()` fires the "rename" event that the plugin
 * handles. The handler then calls `vault.process()` on every markdown file —
 * which blocks the renderer thread for >30s. By not awaiting, we return from
 * the executeObsidian call immediately and the rename + link update runs in
 * the background. We then poll from Node.js for the result.
 */
async function fireRename(oldPath: string, newPath: string): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, old_p, new_p) => {
      const o = obsidian.normalizePath(old_p);
      const n = obsidian.normalizePath(new_p);
      const file = app.vault.getAbstractFileByPath(o);
      if (!file) throw new Error(`File not found in vault: ${o}`);
      if (!(file instanceof obsidian.TFile)) throw new Error(`Path is not a file: ${o}`);
      // Fire-and-forget — the rename + plugin link update runs asynchronously.
      // The script returns immediately before the renderer blocks.
      app.fileManager.renameFile(file, n).catch(console.error);
    },
    oldPath,
    newPath
  );
}

/**
 * Poll from Node.js until the file on disk satisfies the predicate.
 * Runs outside the Obsidian renderer — no script timeout risk.
 */
async function waitForFileContent(
  vaultPath: string,
  relPath: string,
  predicate: (content: string) => boolean,
  timeoutMs = 60000
): Promise<string> {
  const absPath = path.join(vaultPath, relPath);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(absPath)) {
      const content = fs.readFileSync(absPath, "utf8");
      if (predicate(content)) return content;
    }
    await delay(300);
  }
  const content = fs.existsSync(absPath)
    ? fs.readFileSync(absPath, "utf8")
    : "<file missing>";
  throw new Error(
    `Timeout: expected content not found in ${relPath}\nActual:\n${content}`
  );
}

// ---------------------------------------------------------------------------
// Scenario 1 – Basic rename: wiki link in referencing note updates
//
// Fixture files (in vault-minimal/english-class/):
//   - Pasted image 20260107180902.png
//   - Homework.md  →  contains ![[Pasted image 20260107180902.png]]
// ---------------------------------------------------------------------------
describe("Scenario 1 – Basic rename updates wiki link", function () {
  let vaultPath: string;

  before(async function () {
    await browser.reloadObsidian({ vault: FIXTURE_VAULT });
    vaultPath = await getCurrentVaultPath();
  });

  it("renames the image and updates the wiki link in the referencing note", async function () {
    await fireRename(
      "english-class/Pasted image 20260107180902.png",
      "english-class/renamed-image.png"
    );

    const noteContent = await waitForFileContent(
      vaultPath,
      "english-class/Homework.md",
      (c) =>
        c.includes("renamed-image.png") &&
        !c.includes("Pasted image 20260107180902.png")
    );

    // Plugin writes vault-root absolute paths (with leading /)
    expect(noteContent).toContain("renamed-image.png");
    expect(noteContent).not.toContain("Pasted image 20260107180902.png");
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 – Alias/size suffix |300 preserved on rename
//
// Fixture files:
//   - img.png
//   - test-size-suffix.md  →  contains ![[img.png|300]]
// ---------------------------------------------------------------------------
describe("Scenario 2 – Size suffix |300 preserved after rename", function () {
  let vaultPath: string;

  before(async function () {
    await browser.reloadObsidian({ vault: FIXTURE_VAULT });
    vaultPath = await getCurrentVaultPath();
  });

  it("preserves |300 suffix after renaming img.png to photo.png", async function () {
    await fireRename("img.png", "photo.png");

    const noteContent = await waitForFileContent(
      vaultPath,
      "test-size-suffix.md",
      (c) => c.includes("photo.png") && !c.includes("![[img.png")
    );

    expect(noteContent).toContain("|300]]");
    expect(noteContent).toContain("photo.png");
    expect(noteContent).not.toContain("![[img.png");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 – Substring safety: renaming a.png must not affect data.png
//
// Fixture files:
//   - a.png, data.png
//   - test-substring.md  →  contains ![[a.png]] and ![[data.png]]
// ---------------------------------------------------------------------------
describe("Scenario 3 – Substring safety: renaming a.png leaves data.png untouched", function () {
  let vaultPath: string;

  before(async function () {
    await browser.reloadObsidian({ vault: FIXTURE_VAULT });
    vaultPath = await getCurrentVaultPath();
  });

  it("renaming a.png to b.png does not affect the data.png link", async function () {
    await fireRename("a.png", "b.png");

    const noteContent = await waitForFileContent(
      vaultPath,
      "test-substring.md",
      (c) => c.includes("b.png") && !c.includes("![[a.png]]")
    );

    // The a.png link must be updated
    expect(noteContent).toContain("b.png");
    // The data.png link must be byte-identical — the rename of a.png must not touch it
    expect(noteContent).toContain("![[data.png]]");
    expect(noteContent).not.toContain("![[a.png]]");
    // Guard: data.png must not have been corrupted by a substring match
    expect(noteContent).not.toMatch(/datb\.png|data\.b\.png/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 – Code-fence safety: link inside fences must be byte-identical
//
// Fixture files:
//   - fence-img.png
//   - test-codefence.md  →  contains ![[fence-img.png]] OUTSIDE and INSIDE a ``` fence
// ---------------------------------------------------------------------------
describe("Scenario 4 – Code-fence safety: fenced image link untouched", function () {
  let vaultPath: string;

  before(async function () {
    await browser.reloadObsidian({ vault: FIXTURE_VAULT });
    vaultPath = await getCurrentVaultPath();
  });

  it("the link inside the code fence is byte-identical after rename", async function () {
    await fireRename("fence-img.png", "fence-img-renamed.png");

    // Wait for the link OUTSIDE the fence to be updated
    const noteContent = await waitForFileContent(
      vaultPath,
      "test-codefence.md",
      (c) => c.includes("fence-img-renamed.png")
    );

    // The link outside the fence must be updated
    expect(noteContent).toContain("fence-img-renamed.png");
    // The link inside the fenced block must remain byte-identical (original content)
    expect(noteContent).toContain("```\n![[fence-img.png]]\n```");
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 – Startup safety: opening vault must not modify note files
//
// Verifies the plugin's `onLayoutReady` guard: images present at vault open
// time must not trigger the create handler and rewrite any note files.
// ---------------------------------------------------------------------------
describe("Scenario 5 – Startup safety: no note files modified on vault open", function () {
  let vaultPath: string;
  let mtimesBefore: Record<string, number>;

  before(async function () {
    await browser.reloadObsidian({ vault: FIXTURE_VAULT });
    vaultPath = await getCurrentVaultPath();

    // Snapshot note file mtimes immediately after Obsidian opens
    mtimesBefore = {};
    const allEntries = fs.readdirSync(vaultPath, { recursive: true }) as string[];
    for (const entry of allEntries) {
      if (entry.endsWith(".md")) {
        const abs = path.join(vaultPath, entry);
        if (fs.existsSync(abs)) {
          mtimesBefore[entry] = fs.statSync(abs).mtimeMs;
        }
      }
    }
  });

  it("no note files were modified just from opening the vault", async function () {
    // Allow time for any spurious create-event processing to settle
    await delay(5000);

    const violations: string[] = [];
    for (const [rel, mtimeBefore] of Object.entries(mtimesBefore)) {
      const abs = path.join(vaultPath, rel);
      if (fs.existsSync(abs)) {
        const mtimeAfter = fs.statSync(abs).mtimeMs;
        if (mtimeAfter > mtimeBefore) {
          violations.push(`${rel}: mtime changed (${mtimeBefore} → ${mtimeAfter})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
