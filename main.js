'use strict';

var obsidian = require('obsidian');

/**
 * Features:
 * 1) On image rename/move (via Obsidian File Explorer), rewrite all references to
 *    vault-root absolute paths (no ./ or ../). Markdown links are URI-encoded; wiki links keep spaces.
 * 2) On clipboard image paste, insert Markdown image links `![](<vault-root path>)` instead of wiki links.
 * 3) Fallback: When an image file is created (e.g., OS move appears as delete+create),
 *    update links by matching the file name anywhere in the vault.
 * 4) Cut and paste functionality for files via right-click context menu.
 *
 * NOTE: We match BOTH raw names (with spaces) and URI-encoded names (with %20),
 * so dragging a file whose link was previously `![](Pasted%20image ....png)` will be updated.
 */
class ImageLinkUpdaterPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.cutFile = null;
    }
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
            // Ensure folder exists (no-op if it already does)
            await this.ensureFolderExists(folderPath);
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
                // 確保路徑以 / 開頭
                const mdPath = encodeURI(this.ensureLeadingSlash(dest));
                editor.replaceSelection(`![](${mdPath})`);
                editor.setCursor(editor.getCursor());
                console.log('[ImageLinkUpdater] pasted image ->', dest);
            }
        }));
        // --- Single consolidated context menu handler for Cut / Paste ---
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
            // CUT for files
            if (file instanceof obsidian.TFile) {
                menu.addItem((item) => {
                    item
                        .setTitle('Cut')
                        .setIcon('scissors')
                        .onClick(() => {
                        this.cutFile = file;
                        console.log('[ImageLinkUpdater] Cut file:', file.path);
                    });
                });
            }
            // PASTE into a folder when a file is cut
            if (file instanceof obsidian.TFolder && this.cutFile) {
                menu.addItem((item) => {
                    item
                        .setTitle(`Paste "${this.cutFile.name}"`)
                        .setIcon('clipboard')
                        .onClick(async () => {
                        await this.pasteFile(file);
                    });
                });
            }
            // PASTE to root when right-clicking empty space in file explorer
            if (!file && this.cutFile) {
                menu.addItem((item) => {
                    item
                        .setTitle(`Paste "${this.cutFile.name}" to root`)
                        .setIcon('clipboard')
                        .onClick(async () => {
                        await this.pasteToRoot();
                    });
                });
            }
        }));
    }
    /** Ensure a folder exists (skip if root or already exists) */
    async ensureFolderExists(folderPath) {
        const normalized = obsidian.normalizePath(folderPath);
        if (!normalized || normalized === '/')
            return;
        try {
            // If it already exists, this will throw; that's fine.
            await this.app.vault.createFolder(normalized);
        }
        catch (_e) {
            /* already exists */
        }
    }
    /**
     * Paste the cut file to the specified folder
     */
    async pasteFile(targetFolder) {
        if (!this.cutFile)
            return;
        const oldPath = this.cutFile.path;
        const newPath = obsidian.normalizePath(`${targetFolder.path}/${this.cutFile.name}`);
        try {
            // Check if file with same name already exists in target folder
            const existingFile = this.app.vault.getAbstractFileByPath(newPath);
            if (existingFile) {
                // Generate unique name
                const { name, extension } = this.getFileNameAndExtension(this.cutFile.name);
                const uniquePath = await this.uniquePath(newPath, name, extension, targetFolder.path);
                await this.app.fileManager.renameFile(this.cutFile, uniquePath);
                console.log('[ImageLinkUpdater] Moved file to unique path:', uniquePath);
            }
            else {
                await this.app.fileManager.renameFile(this.cutFile, newPath);
                console.log('[ImageLinkUpdater] Moved file:', oldPath, '->', newPath);
            }
            // Update image links if it's an image file
            if (this.isImage(this.cutFile)) {
                await this.updateImageLinks(oldPath, this.cutFile.path);
            }
            // Clear the cut file
            this.cutFile = null;
        }
        catch (error) {
            console.error('[ImageLinkUpdater] Error moving file:', error);
        }
    }
    /**
     * Paste the cut file to the vault root
     */
    async pasteToRoot() {
        if (!this.cutFile)
            return;
        const oldPath = this.cutFile.path;
        const newPath = this.cutFile.name;
        try {
            // Check if file with same name already exists in root
            const existingFile = this.app.vault.getAbstractFileByPath(newPath);
            if (existingFile) {
                // Generate unique name
                const { name, extension } = this.getFileNameAndExtension(this.cutFile.name);
                const uniquePath = await this.uniquePath(newPath, name, extension, '');
                await this.app.fileManager.renameFile(this.cutFile, uniquePath);
                console.log('[ImageLinkUpdater] Moved file to root with unique path:', uniquePath);
            }
            else {
                await this.app.fileManager.renameFile(this.cutFile, newPath);
                console.log('[ImageLinkUpdater] Moved file to root:', oldPath, '->', newPath);
            }
            // Update image links if it's an image file
            if (this.isImage(this.cutFile)) {
                await this.updateImageLinks(oldPath, this.cutFile.path);
            }
            // Clear the cut file
            this.cutFile = null;
        }
        catch (error) {
            console.error('[ImageLinkUpdater] Error moving file to root:', error);
        }
    }
    /**
     * Get file name and extension separately
     */
    getFileNameAndExtension(fileName) {
        const lastDotIndex = fileName.lastIndexOf('.');
        if (lastDotIndex === -1) {
            return { name: fileName, extension: '' };
        }
        return {
            name: fileName.substring(0, lastDotIndex),
            extension: fileName.substring(lastDotIndex + 1)
        };
    }
    isImage(file) {
        return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(file.extension.toLowerCase());
    }
    /**
     * 確保路徑以 / 開頭
     */
    ensureLeadingSlash(path) {
        const normalized = obsidian.normalizePath(path);
        return normalized.startsWith('/') ? normalized : `/${normalized}`;
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
        // 確保新路徑以 / 開頭
        const abs = this.ensureLeadingSlash(newPath); // vault-root absolute path
        const absMd = encodeURI(abs); // encoded for Markdown
        // ---- Patterns (case-insensitive) ----
        // Markdown: full old path (raw OR encoded), allowing optional leading '/'
        const mdFull = new RegExp(String.raw `!\[(.*?)\]\(<?(?:/${escapedOldPath}|/${escapedOldPathEnc}|${escapedOldPath}|${escapedOldPathEnc})>?\)`, 'gi');
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
        // 確保新路徑以 / 開頭
        const abs = this.ensureLeadingSlash(newPath);
        const absMd = encodeURI(abs);
        const mdByName = new RegExp(String.raw `!\[(.*?)\]\(<?[^)]*(?:${nameEsc}|${nameEscEnc})[^)]*>?\)`, 'gi');
        const wikiByName = new RegExp(String.raw `!\[\[[^\]]*${nameEsc}\]\]`, 'gi');
        for (const md of mdFiles) {
            const content = await this.app.vault.read(md);
            let changed = false;
            let updated = content
                .replace(mdByName, (_m, alt) => { changed = true; return `![${alt}](${absMd})`; })
                .replace(wikiByName, () => { changed = true; return `![[${abs}]]`; }); // FIX: close brackets
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
            const suffix = ext ? `.${ext}` : '';
            const folderPrefix = folder ? `${folder}/` : '';
            candidate = obsidian.normalizePath(`${folderPrefix}${base} ${attempt}${suffix}`);
            attempt++;
        }
        return candidate;
    }
}

module.exports = ImageLinkUpdaterPlugin;
