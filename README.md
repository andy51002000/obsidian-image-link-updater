# Image Link Updater

[![Version](https://img.shields.io/github/v/release/andy51002000/obsidian-image-link-updater)](https://github.com/andy51002000/obsidian-image-link-updater/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

**Image Link Updater** is a free, open-source Obsidian plugin (AGPL-3.0, desktop) that automatically rewrites broken image links vault-wide whenever you rename, move, or reorganize image files — so your notes always display correctly without any manual link-fixing.

**Stop losing images when you reorganise your vault.** It also intercepts clipboard paste events to save images as standard Markdown links instead of Obsidian's default wiki-link format, and adds a right-click **Cut & Paste** command that moves files and updates every reference in one step.

- 🔄 **Rename or drag** an image in the File Explorer → every reference vault-wide is rewritten to the new path, instantly.
- 📋 **Paste from clipboard** → image is saved to your attachment folder and inserted as a standard Markdown image link (not the default wiki-link format).
- ✂️ **Cut & Paste via right-click context menu** → move one or many files with automatic link updates across your entire vault.
- 🗃️ **Moved outside Obsidian?** The plugin detects delete+create events and still repairs links by filename.

> **Platform:** Desktop only (Windows, macOS, Linux) &nbsp;|&nbsp; **License:** AGPL-3.0 &nbsp;|&nbsp; **Version:** 1.3.13 &nbsp;|&nbsp; **Requires:** Obsidian ≥ 1.5.7

---

## The Problem It Solves

Obsidian does not update image links by default when you rename or move image files. As soon as you reorganize your vault — moving screenshots into subfolders, renaming files for clarity, or restructuring attachment directories — every standard Markdown image link silently breaks, leaving blank images in your notes.

**Image Link Updater fixes this automatically:**

| Trigger | What breaks without the plugin | What Image Link Updater does |
|---|---|---|
| Rename image in File Explorer | Old link becomes broken | Rewrites to the new name vault-wide |
| Move image to a subfolder | Path changes, link points nowhere | Updates to new vault-root path automatically |
| Move image outside Obsidian (OS-level) | Obsidian never sees the event | Detects delete+create pair and fixes by filename |
| Paste image from clipboard | Default inserts wiki-link format | Saves file and inserts standard Markdown link instead |
| Cut & paste multiple files | Links break; must fix manually | Batch-moves files and updates all references in one step |

---

## Features

### Auto-update image links on rename or move

When you rename or move an image in Obsidian's File Explorer, the plugin listens for vault events and rewrites every affected Markdown image link and wiki-image embed across all your notes to reflect the new path. Both raw filenames and URI-encoded filenames (e.g. `My%20image.png`) are matched and updated.

### Paste clipboard images as Markdown links

When you paste an image from the clipboard, the plugin:
1. Intercepts the paste event before Obsidian's default handler
2. Saves the image to your configured attachment folder
3. Inserts a standard Markdown image link with a URI-encoded vault-root path

This keeps your notes portable — standard Markdown image links render correctly in GitHub, MkDocs, Hugo, and any other Markdown renderer, unlike Obsidian's default wiki-link format.

### Cut & Paste files with link updates

Move files efficiently with automatic link updates using the right-click context menu:

**Single file:**
1. Right-click any file → **Cut**
2. Right-click the destination folder → **Paste**

**Multiple files:**
1. Select multiple files (Shift+Click or Ctrl/Cmd+Click)
2. Right-click any selected file → **Cut (X items)**
3. Right-click the destination folder → **Paste X files**

Name conflicts are handled automatically (adds a numeric suffix, e.g. `image 1.png`). Failed moves are retained in the cut buffer so you can retry without re-selecting.

### Works even when files are moved outside Obsidian

If you move image files using your OS file manager (Finder, Explorer, terminal) while Obsidian is open, Obsidian receives a delete+create event pair. Image Link Updater catches this and repairs affected links by filename — provided the filename itself did not change.

**Supported image formats:** PNG, JPG/JPEG, GIF, BMP, SVG, WEBP.

---

## Quick comparison — when to use which plugin

Several plugins tackle overlapping problems. Here is an honest summary to help you pick the right tool.

| Feature | Image Link Updater | Consistent Attachments and Links | Paste Image Rename |
|---|---|---|---|
| Auto-update links on rename/move | ✅ Real-time, automatic | ✅ Via manual command | ❌ |
| Clipboard paste → Markdown link | ✅ | ❌ | ✅ (with rename dialog) |
| Cut & paste with link updates | ✅ | ❌ | ❌ |
| OS-level move fallback (delete+create) | ✅ | ❌ | ❌ |
| Reorganize entire vault attachment structure | ❌ | ✅ | ❌ |
| Rename image at paste time | ❌ | ❌ | ✅ |
| Mobile support | ❌ Desktop only | ✅ | ✅ |
| License | AGPL-3.0 (free) | MIT (free) | MIT (free) |

**Choose Image Link Updater if:** you want broken-link prevention to happen automatically in the background — no commands to run, no batch operations. Just install, enable, and keep working.

**Choose Consistent Attachments and Links if:** you need to migrate an entire existing vault from wiki-links to relative Markdown links, or if you want attachments co-located with notes (note-folder pattern).

**Use both together:** Image Link Updater handles real-time link repair while you work; Consistent Attachments and Links can audit and batch-fix historical inconsistencies.

---

## Installation

### Community Plugins (recommended)

1. Open **Settings → Community plugins → Browse**
2. Search **"Image Link Updater"** and click **Install**
3. Enable the plugin

### Manual install

1. Download `manifest.json` and `main.js` from the [latest release](https://github.com/andy51002000/obsidian-image-link-updater/releases/latest)
2. Create the folder `<your vault>/.obsidian/plugins/image-link-updater/`
3. Place both files inside:

```
image-link-updater/
├─ manifest.json
└─ main.js
```

4. Enable the plugin in **Settings → Community plugins**

---

## Frequently asked questions

**Why are my image links still broken after I move a file?**  
Image Link Updater only catches moves that happen *through Obsidian's* File Explorer or via the plugin's Cut & Paste menu. If you moved the file using your OS file manager while Obsidian was **closed**, the plugin cannot detect the original path. For moves made outside Obsidian *while it is open*, the fallback delete+create detection will still repair links by filename — provided the filename itself did not change.

**Does this work on mobile (iOS / Android)?**  
No. Image Link Updater is **desktop only** (Windows, macOS, Linux). Mobile support is not currently planned.

**Will it overwrite or corrupt my notes?**  
The plugin rewrites only the image path portion of Markdown image links and wiki-image embeds. It does not touch note content, frontmatter, or non-image links. It is safe to use alongside other plugins.

**My pasted images are still inserting as wiki-links — what's wrong?**  
Make sure the plugin is enabled in **Settings → Community plugins**. If it was just installed, try disabling and re-enabling it. The clipboard paste interception only works in Editing mode (not Reading mode).

**Does it handle filenames with spaces?**  
Yes. The plugin matches both raw filenames (`My image.png`) and URI-encoded filenames (`My%20image.png`). It normalises to URI-encoded format in Markdown links, and leaves wiki-embed paths with spaces un-encoded (matching Obsidian's own convention).

**Is it compatible with Consistent Attachments and Links?**  
Yes. The two plugins complement each other. See the [comparison table](#quick-comparison--when-to-use-which-plugin) above.

---

## How it works

### Automatic link updates

When you move or rename image files, the plugin:
1. Listens for Obsidian vault `rename` and `create` events
2. Searches all Markdown files for references to the old path
3. Rewrites links to use vault-root absolute paths
4. Handles both standard Markdown image links and wiki-image embed formats
5. Skips links inside fenced code blocks to avoid rewriting examples

### Clipboard image handling

When you paste an image:
1. Intercepts the paste event (only if Obsidian's handler hasn't claimed it first)
2. Saves the image binary to your configured attachment folder using Obsidian's public API
3. Inserts a Markdown link with URI-encoded path (parentheses in filenames are encoded as `%28`/`%29` to maintain valid Markdown)

### Cut & Paste with link updates

When you cut and paste files:
1. Stores the selected files in memory when you choose Cut
2. Moves files to the destination on Paste using Obsidian's rename API (which fires the rename event that triggers link updates)
3. Retains failed files in the cut buffer so you can retry
4. Uses retry-on-collision to resolve name conflicts without a TOCTOU race

---

## Configuration

Open **Settings → Image Link Updater** to access plugin options:

- **Debug logging** — Enable to log detailed plugin activity to the developer console (Ctrl+Shift+I / Cmd+Option+I). Useful for troubleshooting. Off by default.

The plugin also respects your existing Obsidian settings:
- **Attachment folder path** — pasted images are saved to the folder configured in Obsidian's Files & Links settings, including relative paths like `./attachments`.
- **Link format** — Markdown image links are generated with URI-encoded vault-root paths.

---

## Troubleshooting

**Links not updating after rename or move?**
- Check the developer console (Ctrl+Shift+I / Cmd+Option+I) for `[ImageLinkUpdater]` messages — enable **Debug logging** in plugin settings first.
- Ensure the file extension is a supported image format: `png`, `jpg`, `jpeg`, `gif`, `bmp`, `svg`, `webp`.
- Moves made while Obsidian was closed cannot be detected. Use the Cut & Paste menu for guaranteed link updates.

**Cut option not appearing?**
- Make sure the plugin is enabled in **Settings → Community plugins**.
- Check that you are right-clicking on a file (not a folder) to see the Cut option.

**Paste not working?**
- Ensure you have cut files first (a notification confirms the cut).
- Right-click on a folder or in empty space to see the Paste option.
- Check the developer console for any error messages.

**Pasted images inserting as wiki-links?**
- Confirm the plugin is enabled and you are in Editing mode (not Reading mode).
- Disable and re-enable the plugin to reload the paste handler.

---

## Plugin Details

| Field | Value |
|---|---|
| **Plugin ID** | `image-link-updater` |
| **Version** | 1.3.13 |
| **Author** | Andy Lai |
| **License** | AGPL-3.0-or-later (free, open-source) |
| **Platform** | Desktop only (Windows, macOS, Linux) |
| **Minimum Obsidian** | 1.5.7 |
| **Repository** | https://github.com/andy51002000/obsidian-image-link-updater |
| **Community listing** | https://obsidian.md/plugins?id=image-link-updater |

---

## License

Image Link Updater is released under the [GNU Affero General Public License v3.0 or later](./LICENSE).

---

## Building from source

```bash
# 1. Clone the repo
git clone https://github.com/andy51002000/obsidian-image-link-updater.git
cd obsidian-image-link-updater

# 2. Install dependencies
npm install

# 3. Build
npm run build
```

Copy `manifest.json` and `main.js` into your vault's `.obsidian/plugins/image-link-updater/` folder.

---

<a href="https://buymeacoffee.com/andy51002000" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-green.png" alt="Buy Me A Coffee" width="200" />
</a>
