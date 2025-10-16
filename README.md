# Image Link Updater (Obsidian Plugin)

<a href="https://buymeacoffee.com/andy51002000" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-green.png" alt="Buy Me A Coffee" width="200" />
</a>

Update every image link in your vault **automatically**.


* 🔄 **Drag / Rename** an image in Obsidian File Explorer → every `![…](…)` or `![[…]]` reference is rewritten to the new vault‑root path.
* 📋 **Paste** an image from the clipboard → stored in a preferred custom subfolder (if configured) or a nearby `assets/` (then `images/`) folder when available (configurable), otherwise beside the active note, and inserted as **Markdown** `![](<path>)` (instead of the default wiki link).
* ✂️ **Cut & Paste** files with context menu → move single or multiple files and automatically update all image links.
* 🗃 **Fallback for OS moves** (delete + create events) – if you move images outside Obsidian, links are still fixed by filename.

---

## Why use it?

* **Stop broken screenshots** – keep your docs intact when you reorganise folders.
* **Markdown‑first** workflow – pasting images no longer forces wiki links.
* **Works with spaces** – matches both raw names (`My image.png`) and URI‑encoded names (`My%20image.png`).
* **Efficient file management** – cut and paste multiple files at once with automatic link updates.

---

## Features in detail

| Action                    | Before                                    | After                                             |
| ------------------------- | ----------------------------------------- | ------------------------------------------------- |
| **Move / Rename** image   | `![Alt](assets/img.png)`                  | `![Alt](Docs/assets/img.png)`                     |
| **Paste** image           | *Default Obsidian*: `![[Pasted image …]]` | *Plugin*: `![](Docs/Note/Pasted%20image%202025…png)` |
| **Cut & Paste** files     | Manual drag with broken links             | Right-click cut/paste with auto-updated links     |
| **Move outside Obsidian** | `![](foo.png)` *(broken)*                 | `![](NewFolder/foo.png)`                          |

*Rewrites vault‑wide; wiki links keep spaces un‑encoded.*

---

## Cut & Paste Files

Move files efficiently with automatic link updates:

### Single File
1. Right-click on any file → **Cut**
2. Navigate to destination folder
3. Right-click on folder → **Paste**

### Multiple Files
1. Select multiple files (Shift + Click or Ctrl + Click)
2. Right-click on any selected file → **Cut (X items)**
3. Right-click on destination folder → **Paste X files**

**Features:**
- Automatically handles name conflicts (adds numbers like `file 1.png`)
- Updates all image links throughout your vault
- Works with both image and non-image files
- Shows notifications for success/failure
- Can paste to folders or vault root

---

## Installation

### Community Plugins (recommended)
Once approved:
1. `Settings → Community plugins → Browse`
2. Search **"Image Link Updater"** and click **Install**
3. Enable the plugin

### Manual
1. Download the latest release assets: `manifest.json`, `main.js`, (optional `styles.css`)
2. Create a folder `<your vault>/.obsidian/plugins/image-link-updater/`
3. Place the files inside, matching this layout:

```
image-link-updater/
├─ manifest.json   # "main": "main.js"
└─ main.js
```

4. Enable the plugin in **Settings → Community plugins**

---

## Building from source

```bash
# 1. clone
git clone https://github.com/andy51002000/obsidian-image-link-updater.git
cd obsidian-image-link-updater

# 2. install deps
npm install

# 3. compile (main.js generated in dist/ or root depending on manifest)
npm run build
```

Copy the compiled files (`manifest.json`, `main.js`) into your vault's plugins folder.

---

## How it works

### Automatic Link Updates
When you move or rename image files, the plugin:
1. Detects the change via Obsidian's vault events
2. Searches all markdown files for references to the old path
3. Rewrites links to use vault-root absolute paths
4. Handles both Markdown `![](path)` and Wiki `![[path]]` formats

### Clipboard Image Handling
When you paste an image:
1. Intercepts the paste event
2. Saves the image to your preferred subfolder (custom name, then `assets/`, then `images/` when present and the preference is enabled) or the note's own folder
3. Inserts a Markdown link with URI-encoded path
4. Ensures proper leading slash for vault-root paths

### Cut & Paste with Link Updates
When you cut and paste files:
1. Stores the selected files in memory
2. Moves files to the destination folder on paste
3. Automatically updates all image links if moving image files
4. Handles multiple files in batch operations

---

## Settings & Configuration

Open **Settings → Community plugins → Image Link Updater** to customise the workflow:

- **Prefer assets/images subfolders** *(default: on)* – When enabled, clipboard images target your preferred subfolder within the note's folder, then `assets/`, then `images/`, before falling back to the note itself.
- **Preferred subfolder name** – Optional text field. Provide a folder name (e.g. `img`) to make it the first destination when saving pasted images beside the note.
- **File naming**: Follows Obsidian's naming conventions
- **Link format**: Generates Markdown links for pasted images

---

## Troubleshooting

**Links not updating after move?**
- Check the developer console (Ctrl+Shift+I / Cmd+Option+I) for `[ImageLinkUpdater]` messages
- Ensure the file is recognized as an image (png, jpg, jpeg, gif, bmp, svg, webp)

**Cut option not appearing?**
- Make sure the plugin is enabled in Settings → Community plugins
- Try rebuilding the plugin if installed manually
- Check that you're right-clicking on files (not folders) for the Cut option

**Paste not working?**
- Ensure you've cut files first (look for notification confirming cut)
- Right-click on a folder or in empty space to paste
- Check console for any error messages

---

## License

Image Link Updater is released under the [GNU Affero General Public License v3.0 or later](./LICENSE).


