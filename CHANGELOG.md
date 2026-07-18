# Changelog

All notable changes to Image Link Updater are documented here.

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
