import { Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath, Editor, Notice, FileManager } from 'obsidian';
import { applyLinkReplacements, encodeMarkdownPath, mimeSubtypeToExtension } from './src/utils';

interface ObsFileManager extends FileManager {
  getAttachmentFolderPath?(file: TFile): string;
}

interface ImageLinkUpdaterSettings {
  debugEnabled: boolean;
}

const DEFAULT_SETTINGS: ImageLinkUpdaterSettings = {
  debugEnabled: false,
};





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
  private cutFiles: TFile[] = [];
  settings: ImageLinkUpdaterSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ImageLinkUpdaterSettingTab(this.app, this));
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

        for (const item of imageItems) {
          const blob = item.getAsFile();
          if (!blob) continue;
          // M4: map MIME subtype to a valid extension (e.g. "svg+xml" → "svg")
          const ext = mimeSubtypeToExtension(blob.type.split('/')[1] || 'png');
          const base = `Pasted image ${this.timestamp()}`;
          const filename = `${base}.${ext}`;

          // M1: use the public getAvailablePathForAttachment API (respects all
          // attachment folder modes incl. relative "./attachments").
          // filename already includes the extension; sourcePath is the active note.
          const dest = normalizePath(
            await this.app.fileManager.getAvailablePathForAttachment(filename, activeFile.path)
          );

          const arrayBuf = await blob.arrayBuffer();
          await this.app.vault.createBinary(dest, arrayBuf);

          // H3: use encodeMarkdownPath so parentheses in filenames are properly escaped
          const mdPath = encodeMarkdownPath(this.ensureLeadingSlash(dest));
          editor.replaceSelection(`![](${mdPath})`);

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

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private logDebug(...data: unknown[]) {
    if (!this.settings.debugEnabled) {
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
    const failedFiles: TFile[] = [];

    for (const file of this.cutFiles) {
      try {
        const oldPath = file.path;
        const baseNewPath = normalizePath(`${targetFolder.path}/${file.name}`);

        // Use retry-on-collision: attempt the rename; if the target already exists,
        // increment a suffix counter and retry. This eliminates the TOCTOU window
        // that existed when probing with adapter.exists() before renaming.
        await this.renameWithRetry(file, baseNewPath);
        this.logDebug('Moved file:', oldPath, '->', file.path);

        successCount++;
      } catch (error) {
        console.error('[ImageLinkUpdater] Error moving file:', file.path, error);
        failedFiles.push(file);
      }
    }

    // Only remove successfully moved files from the cut list so the user can retry
    // the failed ones without needing to cut them again.
    this.cutFiles = failedFiles;

    // Show result notification
    if (successCount > 0) {
      new Notice(`Moved ${successCount} file${successCount > 1 ? 's' : ''} to ${targetFolder.name}`);
    }
    if (failedFiles.length > 0) {
      new Notice(`Failed to move ${failedFiles.length} file${failedFiles.length > 1 ? 's' : ''}`);
    }
  }

  /**
   * Paste multiple cut files to the vault root
   */
  private async pasteToRoot(): Promise<void> {
    if (this.cutFiles.length === 0) return;

    let successCount = 0;
    const failedFiles: TFile[] = [];

    for (const file of this.cutFiles) {
      try {
        const oldPath = file.path;

        // Use retry-on-collision (see renameWithRetry) to avoid the TOCTOU window.
        await this.renameWithRetry(file, file.name);
        this.logDebug('Moved file to root:', oldPath, '->', file.path);

        successCount++;
      } catch (error) {
        console.error('[ImageLinkUpdater] Error moving file to root:', file.path, error);
        failedFiles.push(file);
      }
    }

    // Only remove successfully moved files from the cut list so the user can retry
    // the failed ones without needing to cut them again.
    this.cutFiles = failedFiles;

    // Show result notification
    if (successCount > 0) {
      new Notice(`Moved ${successCount} file${successCount > 1 ? 's' : ''} to root`);
    }
    if (failedFiles.length > 0) {
      new Notice(`Failed to move ${failedFiles.length} file${failedFiles.length > 1 ? 's' : ''}`);
    }
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

  /**
   * Rename a file to targetPath, retrying with an incremented numeric suffix if the
   * target already exists. This avoids the TOCTOU race of the old check-then-act
   * pattern (adapter.exists → renameFile), where a concurrent operation could create
   * the target between the check and the rename.
   *
   * The suffix is inserted before the file extension:
   *   diagram.png → diagram 1.png → diagram 2.png …
   */
  private async renameWithRetry(file: TFile, targetPath: string): Promise<void> {
    const dotIdx = targetPath.lastIndexOf('.');
    const hasExt = dotIdx !== -1 && dotIdx > targetPath.lastIndexOf('/');
    const stem = hasExt ? targetPath.slice(0, dotIdx) : targetPath;
    const ext  = hasExt ? targetPath.slice(dotIdx)    : '';

    let candidate = targetPath;
    let attempt = 0;
    while (true) {
      try {
        await this.app.fileManager.renameFile(file, candidate);
        return;
      } catch (err: unknown) {
        // Detect "already exists" errors reported by different Obsidian/platform combos.
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes('exist') &&
            !msg.toLowerCase().includes('eexist') &&
            !msg.toLowerCase().includes('already')) {
          throw err; // unrelated error — re-throw for the caller to handle
        }
        attempt++;
        candidate = normalizePath(`${stem} ${attempt}${ext}`);
      }
    }
  }
}

class ImageLinkUpdaterSettingTab extends PluginSettingTab {
  private readonly plugin: ImageLinkUpdaterPlugin;

  constructor(app: import('obsidian').App, plugin: ImageLinkUpdaterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Debug logging')
      .setDesc('Log detailed plugin activity to the browser console (open DevTools → Console).')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugEnabled)
          .onChange(async (value) => {
            this.plugin.settings.debugEnabled = value;
            await this.plugin.saveSettings();
          })
      );
  }
}