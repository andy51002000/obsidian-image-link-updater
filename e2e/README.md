# E2E Tests — Image Link Updater

End-to-end tests that launch the real Obsidian app and verify the plugin's
link-update behaviour via actual vault operations.

## Toolchain

**wdio-obsidian-service** (WebdriverIO service purpose-built for Obsidian plugin E2E).  
Rationale: it downloads and manages Obsidian versions automatically, installs the
plugin, creates isolated sandbox vault copies per test, and exposes the Obsidian API
via `browser.executeObsidian()`. Playwright was evaluated but does not have a
comparable Obsidian-specific harness.

The service downloads Obsidian 1.9.14 + a matching Electron 37.6.0 ChromeDriver
into `.obsidian-cache/` on first run. Subsequent runs are fully cached.

## Directory layout

```
e2e/
  wdio.conf.mts          – WebdriverIO config
  vault-minimal/         – Lean fixture vault (4 PNGs + 4 notes)
  vault-fixture/         – Full snapshot of the user's vault (for reference; not
                           used by tests — never open this in Obsidian tests)
  specs/
    image-link-updater.e2e.ts  – All 5 test scenarios
  README.md              – This file
```

## Running the tests

```bash
# Build the plugin first (required — tests load main.js from the repo root)
npm run build

# Run the full E2E suite
npm run test:e2e
```

The suite runs headed (Obsidian window opens) and exits 0 when all pass.

## Scenarios covered

| # | Scenario | What is asserted |
|---|----------|-----------------|
| 1 | Basic rename | Wiki link in referencing note is updated to the new filename |
| 2 | Size-suffix preservation | `![[img.png\|300]]` → renamed → `\|300` suffix kept |
| 3 | Substring safety | Renaming `a.png` does NOT corrupt `![[data.png]]` links |
| 4 | Code-fence safety | Link inside ` ``` ` fences is byte-identical after rename |
| 5 | Startup safety | Opening vault with pre-existing images does NOT rewrite any notes |

## Implementation notes

- **Fire-and-forget rename**: `app.fileManager.renameFile()` is triggered without
  `await` inside the renderer. The plugin's subsequent `updateImageLinks` iterates
  all vault files synchronously and can take >30s — exceeding ChromeDriver's hard
  30s renderer timeout. By returning immediately and polling disk from Node.js, this
  timeout is avoided while still asserting on the actual file bytes.
- **Vault safety**: each test calls `browser.reloadObsidian({ vault })` which creates
  a fresh temporary copy under `/var/folders/…` — the fixture vault is never modified.
- **Original vault safety**: `/Users/andy/Documents/Obsidian Vault` is never opened.
  An mtime baseline is captured before the suite and verified to be identical after.

## Cache / first-run

On first run, the service downloads:
- Obsidian 1.9.14 app asar (~7 MB)
- Obsidian 1.9.14 installer (symlinked to `/Applications/Obsidian.app`)
- Electron 37.6.0 ChromeDriver (~15 MB)

These are cached in `.obsidian-cache/` at the repo root. Total first-run overhead
is ~5 minutes; subsequent runs start in seconds.
