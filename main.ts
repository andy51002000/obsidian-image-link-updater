import { Plugin, TFile, TFolder, normalizePath, Editor, Notice, FileManager } from 'obsidian';
import { applyLinkReplacements, encodeMarkdownPath, mimeSubtypeToExtension } from './src/utils';

interface ObsFileManager extends FileManager {
  getAttachmentFolderPath?(file: TFile): string;
  getAvailablePathForAttachment?(filename: string, extension: string, file: TFile): Promise<string>;
}





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
export default class ImageLinkUpdaterPlugin extends Plugin {
  private cutFiles: TFile[] = []; // Store multiple files that were cut
  private readonly debugEnabled = false;

  onload() {
    // --- Rename/Move handler ---
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile && this.isImage(file)) {
          this.logDebug('rename event', { oldPath, newPath: file.path });
          await this.updateImageLinks(oldPath, file.path);
        }
      })
    );

    // --- Create handler (covers OS-level moves that appear as delete+create) ---
    // Guard with onLayoutReady so that files already present at vault load do not
    // trigger a mass rewrite on every startup (fixes O(images × notes) startup reads).
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on('create', async (file) => {
          if (file instanceof TFile && this.isImage(file)) {
            this.logDebug('create event', { path: file.path });
            await this.updateImageLinksByFilename(file.name, file.path);
          }
        })
      );
    });

    // --- Clipboard image paste handler ---
    this.registerEvent(
      this.app.workspace.on('editor-paste', async (evt: ClipboardEvent, editor: Editor) => {
        // M2: check defaultPrevented before our own guard, and skip if another handler claimed it
        if (evt.defaultPrevented) return;

        const items = evt?.clipboardData?.items ? Array.from(evt.clipboardData.items) : [];
        const imageItems = items.filter((i) => i.kind === 'file' && i.type?.startsWith('image/'));
        if (imageItems.length === 0) return; // let Obsidian handle non-image

        // M2: null-guard activeFile BEFORE calling preventDefault so non-image pastes
        // are never swallowed silently when there is no active file.
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        evt.preventDefault(); // stop default ![[...]] paste

        const fm = this.app.fileManager as ObsFileManager;

        for (const item of imageItems) {
          const blob = item.getAsFile();
          if (!blob) continue;
          // M4: map MIME subtype to a valid extension (e.g. "svg+xml" → "svg")
          const ext = mimeSubtypeToExtension(blob.type.split('/')[1] || 'png');
          const base = `Pasted image ${this.timestamp()}`;
          const filename = `${base}.${ext}`;

          // M1: prefer public getAvailablePathForAttachment (respects all attachment
          // folder modes incl. relative "./attachments") over the private API.
          let dest: string;
          if (fm.getAvailablePathForAttachment) {
            dest = normalizePath(await fm.getAvailablePathForAttachment(filename, ext, activeFile));
          } else {
            // Fallback: derive folder from the private API or the file's parent.
            let folderPath: string;
            if (fm.getAttachmentFolderPath) {
              folderPath = normalizePath(fm.getAttachmentFolderPath(activeFile));
            } else {
              const parent = fm.getNewFileParent(activeFile.path);
              folderPath = normalizePath(parent?.path ?? '/');
            }
            await this.ensureFolderExists(folderPath);
            dest = normalizePath(`${folderPath}/${filename}`);
            dest = await this.uniquePath(dest, base, ext, folderPath);
          }

          const arrayBuf = await blob.arrayBuffer();
          await this.app.vault.createBinary(dest, arrayBuf);

          // H3: use encodeMarkdownPath so parentheses in filenames are properly escaped
          const mdPath = encodeMarkdownPath(this.ensureLeadingSlash(dest));
          editor.replaceSelection(`![](${mdPath})`);
          editor.setCursor(editor.getCursor());

          this.logDebug('pasted image ->', dest);
        }
      })
    );

    // --- Context menu handler for Cut / Paste (similar to "New folder with selection") ---
    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        // This event fires when right-clicking with multiple files selected
        // files is an array of selected files/folders
        const selectedFiles = files.filter((f): f is TFile => f instanceof TFile);

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
                new Notice(`Cut ${this.cutFiles.length} file${this.cutFiles.length > 1 ? 's' : ''}`);
                this.logDebug('Cut files:', this.cutFiles.map(f => f.path));
              });
          });
        }
      })
    );

    // --- Single file context menu ---
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, source) => {
        // CUT for single file
        if (file instanceof TFile) {
          menu.addItem((item) => {
            item
              .setTitle('Cut')
              .setIcon('scissors')
              .onClick(() => {
                this.cutFiles = [file];
                new Notice(`Cut: ${file.name}`);
                this.logDebug('Cut file:', file.path);
              });
          });
        }

        // PASTE into a folder when files are cut
        if (file instanceof TFolder && this.cutFiles.length > 0) {
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
        if (file instanceof TFile && this.cutFiles.length > 0) {
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
                } else {
                  await this.pasteToRoot();
                }
              });
          });
        }
      })
    );
  }

  private logDebug(...data: unknown[]) {
    if (!this.debugEnabled) {
      return;
    }
    console.debug('[ImageLinkUpdater]', ...data);
  }

  /**
   * Get currently selected files from file explorer
   */




  /** Ensure a folder exists (skip if root or already exists) */
  private async ensureFolderExists(folderPath: string) {
    const normalized = normalizePath(folderPath);
    if (!normalized || normalized === '/') return;
    try {
      await this.app.vault.createFolder(normalized);
    } catch {
      /* already exists */
    }
  }

  /**
   * Paste multiple cut files to the specified folder
   */
  private async pasteFiles(targetFolder: TFolder): Promise<void> {
    if (this.cutFiles.length === 0) return;

    let successCount = 0;
    let failCount = 0;

    for (const file of this.cutFiles) {
      try {
        const oldPath = file.path;
        let newPath = normalizePath(`${targetFolder.path}/${file.name}`);

        // Check if file with same name already exists in target folder
        const existingFile = this.app.vault.getAbstractFileByPath(newPath);
        if (existingFile) {
          // Generate unique name
          const { name, extension } = this.getFileNameAndExtension(file.name);
          newPath = await this.uniquePath(newPath, name, extension, targetFolder.path);
        }

        // Move the file. fileManager.renameFile already fires the vault 'rename' event
        // which triggers updateImageLinks via the registered handler — no explicit call needed (H1).
        await this.app.fileManager.renameFile(file, newPath);
        this.logDebug('Moved file:', oldPath, '->', newPath);

        successCount++;
      } catch (error) {
        console.error('[ImageLinkUpdater] Error moving file:', file.path, error);
        failCount++;
      }
    }

    // Show result notification
    if (successCount > 0) {
      new Notice(`Moved ${successCount} file${successCount > 1 ? 's' : ''} to ${targetFolder.name}`);
    }
    if (failCount > 0) {
      new Notice(`Failed to move ${failCount} file${failCount > 1 ? 's' : ''}`);
    }

    // Clear the cut files
    this.cutFiles = [];
  }

  /**
   * Paste multiple cut files to the vault root
   */
  private async pasteToRoot(): Promise<void> {
    if (this.cutFiles.length === 0) return;

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

        // Move the file. fileManager.renameFile already fires the vault 'rename' event
        // which triggers updateImageLinks via the registered handler — no explicit call needed (H1).
        await this.app.fileManager.renameFile(file, newPath);
        this.logDebug('Moved file to root:', oldPath, '->', newPath);

        successCount++;
      } catch (error) {
        console.error('[ImageLinkUpdater] Error moving file to root:', file.path, error);
        failCount++;
      }
    }

    // Show result notification
    if (successCount > 0) {
      new Notice(`Moved ${successCount} file${successCount > 1 ? 's' : ''} to root`);
    }
    if (failCount > 0) {
      new Notice(`Failed to move ${failCount} file${failCount > 1 ? 's' : ''}`);
    }

    // Clear the cut files
    this.cutFiles = [];
  }

  /**
   * Get file name and extension separately
   */
  private getFileNameAndExtension(fileName: string): { name: string; extension: string } {
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return { name: fileName, extension: '' };
    }
    return {
      name: fileName.substring(0, lastDotIndex),
      extension: fileName.substring(lastDotIndex + 1)
    };
  }

  private isImage(file: TFile): boolean {
    return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(file.extension.toLowerCase());
  }

  /**
   * 確保路徑以 / 開頭
   */
  private ensureLeadingSlash(path: string): string {
    const normalized = normalizePath(path);
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  /** Update links using both full old path and file name */
  private async updateImageLinks(oldPath: string, newPath: string) {
    const mdFiles = this.app.vault.getMarkdownFiles();
    const oldFileName = oldPath.split('/').pop() ?? '';
    const abs = this.ensureLeadingSlash(newPath);

    for (const md of mdFiles) {
      try {
        await (this.app.vault as any).process(md, (content: string) => {
          const updated = applyLinkReplacements(content, oldPath, oldFileName, abs);
          if (updated !== content) {
            this.logDebug('updated file', { mdFile: md.path, to: abs });
          }
          return updated;
        });
      } catch (err) {
        console.error('[ImageLinkUpdater] Failed to update links in', md.path, err);
        new Notice(`Image Link Updater: failed to update ${md.name} — see console for details`);
      }
    }
  }

  /** Update links by file name only (used on create fallback) */
  private async updateImageLinksByFilename(fileName: string, newPath: string) {
    const mdFiles = this.app.vault.getMarkdownFiles();
    const abs = this.ensureLeadingSlash(newPath);

    for (const md of mdFiles) {
      try {
        await (this.app.vault as any).process(md, (content: string) => {
          const updated = applyLinkReplacements(content, fileName, fileName, abs);
          if (updated !== content) {
            this.logDebug('updated by filename', { mdFile: md.path, to: abs });
          }
          return updated;
        });
      } catch (err) {
        console.error('[ImageLinkUpdater] Failed to update links in', md.path, err);
        new Notice(`Image Link Updater: failed to update ${md.name} — see console for details`);
      }
    }
  }

  private timestamp(): string {
    const d = new Date();
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  private async uniquePath(dest: string, base: string, ext: string, folder: string): Promise<string> {
    let attempt = 1;
    const exists = async (p: string) => !!(await this.app.vault.adapter.exists(p));
    let candidate = dest;
    while (await exists(candidate)) {
      const suffix = ext ? `.${ext}` : '';
      const folderPrefix = folder ? `${folder}/` : '';
      candidate = normalizePath(`${folderPrefix}${base} ${attempt}${suffix}`);
      attempt++;
    }
    return candidate;
  }
}