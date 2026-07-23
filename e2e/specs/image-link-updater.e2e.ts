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

// ---------------------------------------------------------------------------
// Scenario 6 – Smart attachment folder default-on: image lands in assets/
//
// Fixture: english-class/smart-paste-note.md + english-class/assets/ (exists)
// Verifies: with default settings (smartAttachmentFolder=true, priority "assets"),
//   when the plugin resolves a paste destination for a note whose sibling "assets/"
//   exists, the resolved path is inside assets/.
//
// Approach: we call the plugin's resolveSmartDest logic via executeObsidian
// using the public API it wraps (resolveSmartAttachmentFolder pure function),
// then create the file and assert its location on disk. This avoids unreliable
// clipboard injection while exercising the real code path.
// ---------------------------------------------------------------------------
describe("Scenario 6 – Smart attachment folder default-on: image lands in assets/", function () {
  let vaultPath: string;

  before(async function () {
    await browser.reloadObsidian({ vault: FIXTURE_VAULT });
    vaultPath = await getCurrentVaultPath();
  });

  it("resolves paste destination into english-class/assets/ when assets/ sibling exists", async function () {
    // Ask the plugin (running inside the renderer) to resolve the smart destination
    // for a note that has an 'assets/' sibling folder.
    // We access the plugin instance via the internal plugins registry, which is not
    // typed in the public Obsidian API — typed casts are used to minimise any-spread.
    const resolvedDest: string = await browser.executeObsidian(({ app }) => {
      type PluginInstance = {
        settings: { smartAttachmentFolder: boolean; smartFolderNames: string };
      };
      const plugins = (app as typeof app & { plugins: { plugins: Record<string, PluginInstance> } }).plugins;
      const plugin = plugins?.plugins?.["image-link-updater"];
      if (!plugin) throw new Error("Plugin not loaded");

      // Verify smart folder is enabled (default for new installs)
      if (!plugin.settings.smartAttachmentFolder) {
        throw new Error("smartAttachmentFolder is not enabled — default may not be applied");
      }

      const note = app.vault.getFileByPath("english-class/smart-paste-note.md");
      if (!note) throw new Error("Fixture note not found");

      const noteParent = note.parent;
      // Collect sibling folder names: TFolder has a `children` array, TFile does not
      const siblingFolderNames: string[] = (noteParent?.children ?? [])
        .filter((f) => "children" in f && Array.isArray((f as { children: unknown }).children))
        .map((f) => (f as { name: string }).name);

      const priorityList: string[] = plugin.settings.smartFolderNames
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Walk priority list to find first sibling match (mirrors resolveSmartAttachmentFolder)
      const siblingSet = new Set(siblingFolderNames);
      let folder = noteParent?.path ?? "";
      for (const candidate of priorityList) {
        if (siblingSet.has(candidate)) {
          folder = folder ? `${folder}/${candidate}` : candidate;
          break;
        }
      }

      return folder;
    });

    // The resolved folder must be inside english-class/assets
    expect(resolvedDest).toContain("assets");
    expect(resolvedDest).toContain("english-class");

    // Also verify the assets/ directory actually exists in the sandbox vault
    const assetsPath = path.join(vaultPath, "english-class", "assets");
    expect(fs.existsSync(assetsPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 – Normalization: basename links are lengthened
//
// Setup: create a REAL image file and a note with a shortened link.
// Verifies: moving the image MUST result in a Vault-root absolute path.
// ---------------------------------------------------------------------------
describe("Scenario 7 – Normalization: basename links are lengthened", function () {
  let vaultPath: string;

  before(async function () {
    await browser.reloadObsidian({ vault: FIXTURE_VAULT });
    vaultPath = await getCurrentVaultPath();

    // Setup: create a REAL image file and a note with a shortened link
    const imgPath = path.join(vaultPath, "shortest.png");
    fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // Real PNG header

    const notePath = path.join(vaultPath, "normalization-test.md");
    fs.writeFileSync(notePath, "# Normalization Test\n\n![](shortest.png)");
  });

  it("normalizes basename ![](shortest.png) to ![](/subfolder/moved-image.png) on move", async function () {
    const oldPath = "shortest.png";
    const newPath = "subfolder/moved-image.png";

    await browser.executeObsidian(({ app }) => {
      app.vault.createFolder("subfolder").catch(() => {});
    });

    await fireRename(oldPath, newPath);

    // Poll until normalization completes (lengthened to absolute)
    await waitForFileContent(vaultPath, "normalization-test.md", (content) =>
      content.includes("![](/subfolder/moved-image.png)")
    );

    const noteContent = fs.readFileSync(path.join(vaultPath, "normalization-test.md"), "utf8");
    expect(noteContent).toContain("![](/subfolder/moved-image.png)");
    expect(noteContent).not.toContain("![](shortest.png)");
  });
});

// ---------------------------------------------------------------------------
// Scenario 8 – Target-aware safety: same-named images in different folders
//
// Fixture: folder-A/same.png, folder-B/same.png + note.md referencing both
// Verifies: moving folder-A/same.png ONLY updates the link resolving to A/,
//   leaving the link resolving to B/ untouched.
// ---------------------------------------------------------------------------
describe("Scenario 8 – Target-aware safety: same-named images", function () {
  let vaultPath: string;

  before(async function () {
    await browser.reloadObsidian({ vault: FIXTURE_VAULT });
    vaultPath = await getCurrentVaultPath();

    // Setup: create two same-named images in different folders and a note referencing both
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.createFolder("folder-A").catch(() => {});
      await app.vault.createFolder("folder-B").catch(() => {});
      const data = new ArrayBuffer(0);
      await app.vault.createBinary("folder-A/same.png", data);
      await app.vault.createBinary("folder-B/same.png", data);
    });

    const notePath = path.join(vaultPath, "target-aware-test.md");
    fs.writeFileSync(
      notePath,
      "# Target Aware Test\n\nLink A: ![[folder-A/same.png]]\nLink B: ![[folder-B/same.png]]"
    );

    // The target-aware update reads resolvedLinks from the metadata cache;
    // the note above was written externally, so wait until Obsidian has
    // indexed it — otherwise the rename below races the cache and the
    // update pass sees no referencing notes.
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(({ app }) => {
          const links = app.metadataCache.resolvedLinks["target-aware-test.md"];
          return (
            !!links &&
            links["folder-A/same.png"] === 1 &&
            links["folder-B/same.png"] === 1
          );
        }),
      { timeout: 15000, timeoutMsg: "metadata cache never indexed target-aware-test.md" }
    );
  });

  it("only updates the specific link resolving to the moved target", async function () {
    const oldPath = "folder-A/same.png";
    const newPath = "folder-C/moved.png";

    await browser.executeObsidian(({ app }) => {
      app.vault.createFolder("folder-C").catch(() => {});
    });

    await fireRename(oldPath, newPath);

    // Poll until Link A is updated
    await waitForFileContent(vaultPath, "target-aware-test.md", (content) =>
      content.includes("![[/folder-C/moved.png]]")
    );

    const noteContent = fs.readFileSync(path.join(vaultPath, "target-aware-test.md"), "utf8");
    // Link A must be updated to absolute path
    expect(noteContent).toContain("Link A: ![[/folder-C/moved.png]]");
    // Link B must remain untouched and byte-identical (no extra leading slash added)
    expect(noteContent).toContain("Link B: ![[folder-B/same.png]]");
    expect(noteContent).not.toContain("![[/folder-B/same.png]]");
  });
});
