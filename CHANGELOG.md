# Changelog

All notable changes to Image Link Updater are documented here.

---

## [1.3.18] - 2026-07-22

### Changed

- **Smart attachment folder enabled by default for new installs** — The Smart attachment folder setting is now on by default. On a fresh install (or any vault with no saved plugin data), clipboard-pasted images are automatically routed to the first matching sibling folder from the priority list (`assets`, then `images`). If no matching sibling folder is found, images fall back to the note's own folder.

  Existing users who have explicitly disabled this setting (saved `false` in plugin data) are unaffected — their preference is preserved when settings are loaded.

  Priority list default: `assets, images` (case-sensitive). Customisable in **Settings → Image Link Updater → Smart folder names**.

---

## [1.3.17] - 2026-07-21

### Changed

- **Faster, more private link updates** — Link updates no longer enumerate every file in the vault. The plugin now uses Obsidian's metadata cache (`resolvedLinks`) to target only the notes that actually reference the renamed or moved image, which is faster in large vaults and means the plugin no longer requests a listing of every file path.
- **More robust link repair after quick successive moves** — Metadata-cache lookups now use a bounded retry with per-destination-path isolation, so moving several images in quick succession (or moving the same image twice quickly) can no longer cause one update to cancel or starve another.

### Internal

- Cleaned up the remaining automated-review warnings in the E2E test suite (unnecessary type assertions, `TFile` cast, bare `setTimeout`).
- Committed `package-lock.json` and switched CI to `npm ci` so builds are reproducible byte-for-byte.
- Release workflow now generates GitHub build provenance attestations (`actions/attest@v4`) for every published asset, and runs the unit test suite before building.

---

## [1.3.16] - 2026-07-19

### Changed

- **License changed to MIT** — The project is now released under the MIT License (Copyright (c) 2026 Andy Lai), replacing the previous AGPL-3.0-or-later license. The AGPL history prior to this release is preserved in the changelog for accuracy.
- **Removed owner-bound repository URLs from README** — The `github.com/andy51002000/...` release badge, manual-install release link, Plugin Details Repository row, and Building-from-source clone URL have been removed or replaced with owner-neutral text to support a potential repository transfer. The Obsidian community listing URL (`obsidian.md/plugins?id=image-link-updater`) is unaffected. Author identity links (authorUrl, fundingUrl) are retained.

---

## [1.3.15] - 2026-07-19

### Fixed

- **Race condition in Smart attachment folder unique-naming** — When the Smart attachment folder feature resolved a destination that already existed, it used an `adapter.exists()` probe loop before calling `createBinary`. This check-then-create pattern has a TOCTOU race window where a concurrent paste could create the same file between the check and the write. Fixed by removing the probe loop entirely and instead wrapping `createBinary` in a retry-on-collision loop (`createBinaryWithRetry`): if the create fails with an "already exists" error, the suffix counter is incremented and the write is retried atomically — the same approach used by `renameWithRetry` for file moves since 1.3.11.

---

## [1.3.14] - 2026-07-19

### Added

- **Smart attachment folder** — New optional setting (disabled by default) that changes where clipboard-pasted images are saved. When enabled, the plugin checks the note's sibling folders in a configurable priority order and saves the image into the first matching folder that already exists. If no match is found, the image is saved into the note's own folder. This is useful for vaults that keep images in a dedicated `assets/` or `images/` subfolder alongside each group of notes.

- **Smart folder names** — Companion text setting (comma-separated, e.g. `assets, images`) that defines the priority order of sibling folder names to probe. Matching is case-sensitive. The field is disabled in the UI when Smart attachment folder is off. Default: `assets, images`.

Both settings are off by default — users who do not opt in will see no change in behavior.

---

## [1.3.13] - 2026-07-18

### Fixed

- **License file corrected** — The LICENSE file now contains the exact canonical GNU AGPL-3.0 text as published by the Free Software Foundation, ensuring it is recognized correctly by automated license scanners (licensee/GitHub's detection). The previous file had minor formatting deviations that caused recognition failures in the Obsidian community directory pre-scan.

### Internal

- Removed internal `as any` type casts from `vault.process()` calls — the Obsidian API has been properly typed since minAppVersion 1.5.7, so the cast is no longer needed.
- Removed the unused `ObsFileManager` local interface (its only remaining member, the private `getAttachmentFolderPath` fallback, was superseded by the public `getAvailablePathForAttachment` API in 1.3.9).
- Added `getSettingDefinitions()` to the settings tab — this declarative API (introduced in Obsidian 1.13) enables settings search indexing and consistent rendering across platforms.
- Eliminated a dead code path in `src/utils.ts` (`afterByName` variable was computed but never used); simplified the two-pass markdown link replacement to remove redundant state.
- Fixed `@wdio/globals` missing from `devDependencies` in `package.json` — it was referenced in `tsconfig.json` `types` but not declared, causing scanner warnings about undeclared type dependencies.
- Fixed e2e test file type casts: replaced `as any` with typed `FileSystemAdapter` (using `getBasePath()` instead of the non-existent `.basePath` property) and `TFile` for the rename call.
- Added `eslint-plugin-obsidianmd` (recommended config) to enforce Obsidian-specific lint rules on `main.ts` and `src/`; 0 errors on current code.

---

## [1.3.12] - 2026-07-18

### Changed

- Metadata-only release preparing for Obsidian Community Plugins directory submission — no functional changes:
  - `manifest.json` description: corrected "markdown" to "Markdown" per the community submission style guide.
  - Added `fundingUrl` (Buy Me a Coffee) to `manifest.json`, matching the existing README link.
  - Raised `minAppVersion` from `1.0.0` to `1.5.7`: the plugin calls `FileManager.getAvailablePathForAttachment()`, which first appears in the public API type definitions in the `obsidian` npm package at version 1.5.7 (absent in 1.4.11 and earlier).

---

## [1.3.11] - 2026-07-18

### Fixed

- **Cut-and-paste could rarely overwrite a file with the same name** — When pasting multiple cut files and the destination already had a name conflict, the plugin probed for available names using a check-then-rename pattern. A concurrent operation (another paste, a file created by another app) could create that name in the gap between the check and the actual move, causing an unexpected collision. The rename now uses a retry-on-collision loop that is free from this race condition: if the destination already exists at the moment of rename, the plugin automatically tries the next numbered suffix without a separate existence check.

### Internal

- Removed the `uniquePath()` helper, which polled `adapter.exists()` in a loop — this is the method that had the race condition. Also removed `getFileNameAndExtension()`, which was only used by `uniquePath()`.
- Hardened `scripts/prepare-release.mjs` with three pre-flight checks that run before packaging: (1) version consistency — fails if `manifest.json`, `package.json`, and `versions.json` do not all agree on the same version; (2) artifact freshness — fails if `main.js` is older than any TypeScript source file, preventing a stale build from shipping; (3) the script now produces a versioned release zip (`image-link-updater-{version}.zip`) alongside the release folder.

---

## [1.3.10] - 2026-07-18

### Fixed

- **Cut selection lost after a partially failed paste** — When moving a batch of files via Cut/Paste and some moves failed, the entire cut list was cleared regardless of outcome, forcing the user to re-cut the failed files before retrying. Failed files now remain in the clipboard so the paste can be retried immediately after resolving the issue (e.g. a permissions error on the target folder).

### Added

- **Debug logging toggle** — A new **Settings → Image Link Updater → Debug logging** toggle lets you enable detailed console output without editing source code. The preference is persisted across vault restarts. Open DevTools → Console to view the debug messages.

---

## [1.3.9] - 2026-07-18

### Fixed

- **Startup rewrite storm** — The plugin no longer scans and rewrites links for images that already existed when the vault was opened. Previously, every image present at launch triggered a full vault scan on startup, causing noticeable lag in large vaults.
- **Short filename matching corruption** — Renaming an image with a short name (e.g. `a.png`) no longer accidentally rewrites links that merely contain that name as a substring (e.g. `data.png`, `banana.png`). Matches are now anchored to path-segment boundaries.
- **Links inside code blocks rewritten** — Image links inside fenced code blocks (` ``` … ``` `) are now left untouched during rename/move operations.
- **Non-atomic file writes** — Link updates now use Obsidian's `vault.process()` for atomic read-modify-write, eliminating a race condition where concurrent edits could be lost. Each file that fails to update now surfaces a user-facing error notice instead of failing silently.
- **Double rewrite during cut-and-paste** — Moving files via the plugin's Cut/Paste menu no longer triggers two concurrent link-update passes. The rename event handler already covers the update; the redundant explicit call has been removed.
- **Wiki links with aliases or headings not updated** — Wiki-style image embeds with a display size, alias, or heading (e.g. `![[image.png|300]]`, `![[image.png|My caption]]`, `![[image.png#section]]`) are now correctly updated on rename, and the suffix is preserved in the result.
- **Filenames with parentheses producing broken Markdown** — Images whose names contain parentheses (e.g. `screenshot (1).png`) now generate correctly encoded paths (`%28`/`%29`) so the resulting Markdown link is valid and renders properly.
- **Pasted SVG files saved with wrong extension** — Pasting an SVG image from the clipboard previously produced a file named `Pasted image … .svg+xml`. The MIME subtype is now mapped to the correct extension (`svg`, `jpg`, etc.).
- **Paste silently swallowed when no note is active** — If no editor was open, calling `preventDefault` before the null-guard meant the clipboard event was consumed without doing anything. The guard order is now correct: the event is only claimed after confirming an active file exists.
- **Paste blocked when another handler already handled the event** — The plugin now checks `evt.defaultPrevented` before acting, so it correctly yields to other handlers that have already processed the paste.
- **Markdown link titles lost on rename** — Links of the form `![alt](image.png "My Title")` now preserve the title attribute when the image is renamed or moved.
- **Attachment folder setting ignored for relative paths** — The paste handler now uses the public `fileManager.getAvailablePathForAttachment()` API, which correctly resolves all attachment folder modes including relative (`./attachments`) settings that the previous private API call handled incorrectly.
- **Build script shipped stale plugin on failure** — The build command now uses `&&` so `main.js` is only copied from `dist/` when the compile step succeeds. Previously a failed build would leave the old artifact in place silently.

### Internal

- Switched build toolchain from `rollup-plugin-typescript2` (broken with the installed dependency versions) to `esbuild` for faster, more reliable builds.
- Added a `vitest`-based unit test suite (`npm test`) with 22 tests covering the core link-matching and path-encoding logic independently of the Obsidian runtime.
- Extracted pure utility functions (`escapeRegExp`, `encodeMarkdownPath`, `mimeSubtypeToExtension`, `buildRenamePatterns`, `applyLinkReplacements`, etc.) into `src/utils.ts` to make them independently testable.

---

## [1.3.8] and earlier

See [GitHub releases](https://github.com/andy51002000/obsidian-image-link-updater/releases) for previous release notes.
