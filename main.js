'use strict';

var obsidian = require('obsidian');

// obsidian-image-link-updater/main.ts
/**
 * Features:
 * 1) On image rename/move (via Obsidian File Explorer), rewrite all references to
 *    vault-root absolute paths (no ./ or ../). Markdown links are URI-encoded; wiki links keep spaces.
 * 2) On clipboard image paste, insert Markdown image links `![](<vault-root path>)` instead of wiki links.
 * 3) Fallback: When an image file is created (e.g., OS move appears as delete+create),
 *    update links by matching the file name anywhere in the vault.
 *
 * NOTE: We match BOTH raw names (with spaces) and URI-encoded names (with %20),
 * so dragging a file whose link was previously `![](Pasted%20image ....png)` will be updated.
 */
class ImageLinkUpdaterPlugin extends obsidian.Plugin {
    async onload() {
        // --- Rename/Move handler ---
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (file instanceof obsidian.TFile && this.isImage(file)) {
                console.log('[ImageLinkUpdater] rename event', { oldPath, newPath: file.path });
                this.updateImageLinks(oldPath, file.path);
            }
        }));
        // --- Create handler (covers OS-level moves that appear as delete+create) ---
        this.registerEvent(this.app.vault.on('create', async (file) => {
            if (file instanceof obsidian.TFile && this.isImage(file)) {
                console.log('[ImageLinkUpdater] create event', { path: file.path });
                await this.updateImageLinksByFilename(file.name, file.path);
            }
        }));
        // --- Clipboard image paste handler ---
        this.registerEvent(this.app.workspace.on('editor-paste', async (evt, editor) => {
            const items = evt?.clipboardData?.items ? Array.from(evt.clipboardData.items) : [];
            const imageItems = items.filter((i) => i.kind === 'file' && i.type?.startsWith('image/'));
            if (imageItems.length === 0)
                return; // let Obsidian handle non-image
            evt.preventDefault(); // stop default ![[...]] paste
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile)
                return;
            // Determine destination folder for attachments
            let folderPath;
            const fm = this.app.fileManager; // internal API
            if (fm?.getAttachmentFolderPath) {
                folderPath = obsidian.normalizePath(fm.getAttachmentFolderPath(activeFile));
            }
            else {
                const parent = fm?.getNewFileParent ? fm.getNewFileParent(activeFile.path) : null;
                folderPath = obsidian.normalizePath(parent?.path ?? '/');
            }
            for (const item of imageItems) {
                const blob = item.getAsFile();
                if (!blob)
                    continue;
                const ext = (blob.type.split('/')[1] || 'png').toLowerCase();
                const base = `Pasted image ${this.timestamp()}`;
                // Compute a unique vault-root path
                let dest = obsidian.normalizePath(`${folderPath}/${base}.${ext}`);
                dest = await this.uniquePath(dest, base, ext, folderPath);
                const arrayBuf = await blob.arrayBuffer();
                await this.app.vault.createBinary(dest, arrayBuf);
                const mdPath = encodeURI(dest); // markdown needs spaces encoded
                editor.replaceSelection(`![](${mdPath})`);
                editor.setCursor(editor.getCursor());
                console.log('[ImageLinkUpdater] pasted image ->', dest);
            }
        }));
    }
    isImage(file) {
        return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(file.extension.toLowerCase());
    }
    /** Update links using both full old path and file name */
    async updateImageLinks(oldPath, newPath) {
        const mdFiles = this.app.vault.getMarkdownFiles();
        const oldFileName = oldPath.split('/').pop() ?? '';
        // Build raw and encoded variants for both path and file name
        const oldPathNorm = obsidian.normalizePath(oldPath);
        const oldPathEnc = encodeURI(oldPathNorm);
        const oldNameEnc = encodeURI(oldFileName);
        const escapedOldPath = this.escapeRegExp(oldPathNorm);
        const escapedOldPathEnc = this.escapeRegExp(oldPathEnc);
        const escapedOldName = this.escapeRegExp(oldFileName);
        const escapedOldNameEnc = this.escapeRegExp(oldNameEnc);
        const abs = obsidian.normalizePath(newPath); // vault-root absolute path
        const absMd = encodeURI(abs); // encoded for Markdown
        // ---- Patterns (case-insensitive) ----
        // Markdown: full old path (raw OR encoded), optionally wrapped in <...>
        const mdFull = new RegExp(String.raw `!\[(.*?)\]\(<?(?:\./)?(?:${escapedOldPath}|${escapedOldPathEnc})>?\)`, 'gi');
        // Markdown: match by file name (raw OR encoded)
        const mdByName = new RegExp(String.raw `!\[(.*?)\]\(<?[^)]*(?:${escapedOldName}|${escapedOldNameEnc})[^)]*>?\)`, 'gi');
        // Wiki links use raw (unencoded) text inside [[...]]
        const wikiFull = new RegExp(String.raw `!\[\[(?:[^\]]*?)${escapedOldPath}\]\]`, 'gi');
        const wikiByName = new RegExp(String.raw `!\[\[[^\]]*${escapedOldName}\]\]`, 'gi');
        for (const md of mdFiles) {
            const content = await this.app.vault.read(md);
            let changed = false;
            let updated = content
                .replace(mdFull, (_m, alt) => { changed = true; return `![${alt}](${absMd})`; })
                .replace(mdByName, (_m, alt) => { changed = true; return `![${alt}](${absMd})`; })
                // Wiki links keep spaces unencoded
                .replace(wikiFull, () => { changed = true; return `![[${abs}]]`; })
                .replace(wikiByName, () => { changed = true; return `![[${abs}]]`; });
            if (changed) {
                await this.app.vault.modify(md, updated);
                console.log('[ImageLinkUpdater] updated file', { mdFile: md.path, to: abs });
            }
            else {
                console.log('[ImageLinkUpdater] no references found in', md.path, 'for', oldFileName);
            }
        }
    }
    /** Update links by file name only (used on create fallback) */
    async updateImageLinksByFilename(fileName, newPath) {
        const mdFiles = this.app.vault.getMarkdownFiles();
        const nameEnc = encodeURI(fileName);
        const nameEsc = this.escapeRegExp(fileName);
        const nameEscEnc = this.escapeRegExp(nameEnc);
        const abs = obsidian.normalizePath(newPath);
        const absMd = encodeURI(abs);
        const mdByName = new RegExp(String.raw `!\[(.*?)\]\(<?[^)]*(?:${nameEsc}|${nameEscEnc})[^)]*>?\)`, 'gi');
        const wikiByName = new RegExp(String.raw `!\[\[[^\]]*${nameEsc}\]\]`, 'gi');
        for (const md of mdFiles) {
            const content = await this.app.vault.read(md);
            let changed = false;
            let updated = content
                .replace(mdByName, (_m, alt) => { changed = true; return `![${alt}](${absMd})`; })
                .replace(wikiByName, () => { changed = true; return `![[${abs}]]`; });
            if (changed) {
                await this.app.vault.modify(md, updated);
                console.log('[ImageLinkUpdater] updated by filename', { mdFile: md.path, to: abs });
            }
        }
    }
    escapeRegExp(str) {
        // Escape regex metacharacters: . * + ? ^ $ { } ( ) | [ ] \
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    timestamp() {
        const d = new Date();
        const p = (n) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }
    async uniquePath(dest, base, ext, folder) {
        let attempt = 1;
        const exists = async (p) => !!(await this.app.vault.adapter.exists(p));
        let candidate = dest;
        while (await exists(candidate)) {
            candidate = obsidian.normalizePath(`${folder}/${base} ${attempt}.${ext}`);
            attempt++;
        }
        return candidate;
    }
}

module.exports = ImageLinkUpdaterPlugin;
