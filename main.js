'use strict';

var obsidian = require('obsidian');

/**
 * Features:
 * 1) On image rename/move (via Obsidian File Explorer), rewrite all references to
 *    vault-root absolute paths (no ./ or ../). Markdown links are URI-encoded; wiki links keep spaces.
 * 2) On clipboard image paste, insert Markdown image links `![](<vault-root path>)` instead of wiki links.
 * 3) Fallback: When an image file is created (e.g., OS move appears as delete+create),
 *    update links by matching the file name anywhere in the vault.
 * 4) Cut and paste functionality for multiple files via right-click context menu.
 *
 * NOTE: We match BOTH raw names (with spaces) and URI-encoded names (with %20),
 * so dragging a file whose link was previously `![](Pasted%20image ....png)` will be updated.
 */
class ImageLinkUpdaterPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.cutFiles = []; // Store multiple files that were cut
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
        // --- Context menu handler for Cut / Paste (similar to "New folder with selection") ---
        this.registerEvent(this.app.workspace.on('files-menu', (menu, files) => {
            // This event fires when right-clicking with multiple files selected
            // files is an array of selected files/folders
            const selectedFiles = files.filter(f => f instanceof obsidian.TFile);
            if (selectedFiles.length > 0) {
                menu.addItem((item) => {
                    const label = selectedFiles.length === 1
                        ? 'Cut'
                        : `Cut (${selectedFiles.length} items)`;
                    item
                        .setTitle(label)
                        .setIcon('scissors')
                        .onClick(() => {
                        this.cutFiles = selectedFiles;
                        new obsidian.Notice(`Cut ${this.cutFiles.length} file${this.cutFiles.length > 1 ? 's' : ''}`);
                        console.log('[ImageLinkUpdater] Cut files:', this.cutFiles.map(f => f.path));
                    });
                });
            }
        }));
        // --- Single file context menu ---
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source) => {
            // CUT for single file
            if (file instanceof obsidian.TFile) {
                menu.addItem((item) => {
                    item
                        .setTitle('Cut')
                        .setIcon('scissors')
                        .onClick(() => {
                        this.cutFiles = [file];
                        new obsidian.Notice(`Cut: ${file.name}`);
                        console.log('[ImageLinkUpdater] Cut file:', file.path);
                    });
                });
            }
            // PASTE into a folder when files are cut
            if (file instanceof obsidian.TFolder && this.cutFiles.length > 0) {
                menu.addItem((item) => {
                    const label = this.cutFiles.length === 1
                        ? `Paste "${this.cutFiles[0].name}"`
                        : `Paste ${this.cutFiles.length} files`;
                    item
                        .setTitle(label)
                        .setIcon('clipboard')
                        .onClick(async () => {
                        await this.pasteFiles(file);
                    });
                });
            }
            // PASTE when right-clicking on a file (paste to that file's folder)
            if (file instanceof obsidian.TFile && this.cutFiles.length > 0) {
                menu.addItem((item) => {
                    const targetFolder = file.parent;
                    const folderName = targetFolder?.name || 'root';
                    const label = this.cutFiles.length === 1
                        ? `Paste to ${folderName}`
                        : `Paste ${this.cutFiles.length} files to ${folderName}`;
                    item
                        .setTitle(label)
                        .setIcon('clipboard')
                        .onClick(async () => {
                        if (targetFolder) {
                            await this.pasteFiles(targetFolder);
                        }
                        else {
                            await this.pasteToRoot();
                        }
                    });
                });
            }
        }));
    }
    /**
     * Get currently selected files from file explorer
     */
    getSelectedFiles() {
        try {
            const fileExplorer = this.app.workspace.getLeavesOfType('file-explorer')[0];
            if (!fileExplorer) {
                console.log('[ImageLinkUpdater] File explorer not found');
                return [];
            }
            const explorerView = fileExplorer.view;
            // Try multiple methods to get selected files
            // Method 1: Try using tree.selectedDoms
            if (explorerView?.tree?.selectedDoms) {
                const selectedFiles = [];
                for (const dom of explorerView.tree.selectedDoms) {
                    const file = explorerView.fileItems?.[dom.dataset?.path];
                    if (file?.file instanceof obsidian.TFile) {
                        selectedFiles.push(file.file);
                    }
                }
                if (selectedFiles.length > 0) {
                    console.log('[ImageLinkUpdater] Found selected files (method 1):', selectedFiles.length);
                    return selectedFiles;
                }
            }
            // Method 2: Try fileItems with is-selected class
            if (explorerView?.fileItems) {
                const selectedFiles = [];
                for (const [path, item] of Object.entries(explorerView.fileItems)) {
                    if (item.selfEl?.hasClass('is-selected')) {
                        const file = this.app.vault.getAbstractFileByPath(path);
                        if (file instanceof obsidian.TFile) {
                            selectedFiles.push(file);
                        }
                    }
                }
                if (selectedFiles.length > 0) {
                    console.log('[ImageLinkUpdater] Found selected files (method 2):', selectedFiles.length);
                    return selectedFiles;
                }
            }
            console.log('[ImageLinkUpdater] No selected files found');
            return [];
        }
        catch (error) {
            console.error('[ImageLinkUpdater] Error getting selected files:', error);
            return [];
        }
    }
    /** Ensure a folder exists (skip if root or already exists) */
    async ensureFolderExists(folderPath) {
        const normalized = obsidian.normalizePath(folderPath);
        if (!normalized || normalized === '/')
            return;
        try {
            await this.app.vault.createFolder(normalized);
        }
        catch (_e) {
            /* already exists */
        }
    }
    /**
     * Paste multiple cut files to the specified folder
     */
    async pasteFiles(targetFolder) {
        if (this.cutFiles.length === 0)
            return;
        let successCount = 0;
        let failCount = 0;
        for (const file of this.cutFiles) {
            try {
                const oldPath = file.path;
                let newPath = obsidian.normalizePath(`${targetFolder.path}/${file.name}`);
                // Check if file with same name already exists in target folder
                const existingFile = this.app.vault.getAbstractFileByPath(newPath);
                if (existingFile) {
                    // Generate unique name
                    const { name, extension } = this.getFileNameAndExtension(file.name);
                    newPath = await this.uniquePath(newPath, name, extension, targetFolder.path);
                }
                // Move the file
                await this.app.fileManager.renameFile(file, newPath);
                console.log('[ImageLinkUpdater] Moved file:', oldPath, '->', newPath);
                // Update image links if it's an image file
                if (this.isImage(file)) {
                    await this.updateImageLinks(oldPath, newPath);
                }
                successCount++;
            }
            catch (error) {
                console.error('[ImageLinkUpdater] Error moving file:', file.path, error);
                failCount++;
            }
        }
        // Show result notification
        if (successCount > 0) {
            new obsidian.Notice(`Moved ${successCount} file${successCount > 1 ? 's' : ''} to ${targetFolder.name}`);
        }
        if (failCount > 0) {
            new obsidian.Notice(`Failed to move ${failCount} file${failCount > 1 ? 's' : ''}`);
        }
        // Clear the cut files
        this.cutFiles = [];
    }
    /**
     * Paste multiple cut files to the vault root
     */
    async pasteToRoot() {
        if (this.cutFiles.length === 0)
            return;
        let successCount = 0;
        let failCount = 0;
        for (const file of this.cutFiles) {
            try {
                const oldPath = file.path;
                let newPath = file.name;
                // Check if file with same name already exists in root
                const existingFile = this.app.vault.getAbstractFileByPath(newPath);
                if (existingFile) {
                    // Generate unique name
                    const { name, extension } = this.getFileNameAndExtension(file.name);
                    newPath = await this.uniquePath(newPath, name, extension, '');
                }
                // Move the file
                await this.app.fileManager.renameFile(file, newPath);
                console.log('[ImageLinkUpdater] Moved file to root:', oldPath, '->', newPath);
                // Update image links if it's an image file
                if (this.isImage(file)) {
                    await this.updateImageLinks(oldPath, newPath);
                }
                successCount++;
            }
            catch (error) {
                console.error('[ImageLinkUpdater] Error moving file to root:', file.path, error);
                failCount++;
            }
        }
        // Show result notification
        if (successCount > 0) {
            new obsidian.Notice(`Moved ${successCount} file${successCount > 1 ? 's' : ''} to root`);
        }
        if (failCount > 0) {
            new obsidian.Notice(`Failed to move ${failCount} file${failCount > 1 ? 's' : ''}`);
        }
        // Clear the cut files
        this.cutFiles = [];
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
            const suffix = ext ? `.${ext}` : '';
            const folderPrefix = folder ? `${folder}/` : '';
            candidate = obsidian.normalizePath(`${folderPrefix}${base} ${attempt}${suffix}`);
            attempt++;
        }
        return candidate;
    }
}

module.exports = ImageLinkUpdaterPlugin;
