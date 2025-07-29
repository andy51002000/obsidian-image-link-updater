# Image Link Updater (Obsidian Plugin)

Update every image link in your vault **automatically**.

* 🔄 **Drag / Rename** an image in Obsidian File Explorer → every `![…](…)` or `![[…]]` reference is rewritten to the new vault‑root path.
* 📋 **Paste** an image from the clipboard → stored in your attachment folder and inserted as **Markdown** `![](<path>)` (instead of the default wiki link).
* 🗃 **Fallback for OS moves** (delete + create events) – if you move images outside Obsidian, links are still fixed by filename.

---

## Why use it?

* **Stop broken screenshots** – keep your docs intact when you reorganise folders.
* **Markdown‑first** workflow – pasting images no longer forces wiki links.
* **Works with spaces** – matches both raw names (`My image.png`) and URI‑encoded names (`My%20image.png`).

---

## Features in detail

| Action                    | Before                                    | After                                             |
| ------------------------- | ----------------------------------------- | ------------------------------------------------- |
| **Move / Rename** image   | `![Alt](assets/img.png)`                  | `![Alt](Docs/assets/img.png)`                     |
| **Paste** image           | *Default Obsidian*: `![[Pasted image …]]` | *Plugin*: `![](Images/Pasted%20image%202025…png)` |
| **Move outside Obsidian** | `![](foo.png)` *(broken)*                 | `![](NewFolder/foo.png)`                          |

*Rewrites vault‑wide; wiki links keep spaces un‑encoded.*

---

## Installation

### Community Plugins (recommended)
Once approved:
1. `Settings → Community plugins → Browse`
2. Search **“Image Link Updater”** and click **Install**
3. Enable the plugin

### Manual
1. Download the latest release assets: `manifest.json`, `main.js`, (optional `styles.css`)
2. Create a folder `<your vault>/.obsidian/plugins/image-link-updater/`
3. Place the files inside, matching this layout:

```
image-link-updater/
├─ manifest.json   # "main": "main.js"
└─ main.js
```

4. Enable the plugin in **Settings → Community plugins**

---

## Building from source

```bash
# 1. clone
git clone https://github.com/andy51002000/obsidian-image-link-updater.git
cd obsidian-image-link-updater

# 2. install deps
npm install

# 3. compile (main.js generated in dist/ or root depending on manifest)
npm run build
```

Copy the compiled files (`manifest.json`, `main.js`) into your vault’s plugins folder.


