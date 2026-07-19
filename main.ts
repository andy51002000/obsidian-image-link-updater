import { Plugin, PluginSettingTab, Setting, SettingDefinitionItem, TFile, TFolder, normalizePath, Editor, Notice } from 'obsidian';
import { applyLinkReplacements, encodeMarkdownPath, mimeSubtypeToExtension, parseSmartFolderNames, resolveSmartAttachmentFolder } from './src/utils';

interface ImageLinkUpdaterSettings {
  debugEnabled: boolean;
  smartAttachmentFolder: boolean;
  smartFolderNames: string;
}

const DEFAULT_SETTINGS: ImageLinkUpdaterSettings = {
  debugEnabled: false,
  smartAttachmentFolder: false,
  smartFolderNames: 'assets, images',
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

          // Resolve destination path: smart folder mode or Obsidian's default API.
          let dest: string;
          if (this.settings.smartAttachmentFolder) {
            dest = await this.resolveSmartDest(filename, activeFile);
          } else {
            // M1: use the public getAvailablePathForAttachment API (respects all
            // attachment folder modes incl. relative "./attachments").
            dest = normalizePath(
              await this.app.fileManager.getAvailablePathForAttachment(filename, activeFile.path)
            );
          }

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
    const data = (await this.loadData()) as Partial<ImageLinkUpdaterSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Resolve the paste destination using the Smart attachment folder logic.
   * Collects sibling folder names from the vault and delegates to the pure
   * resolveSmartAttachmentFolder function, then gets a unique path within that folder.
   */
  private async resolveSmartDest(filename: string, activeFile: TFile): Promise<string> {
    const noteParent = activeFile.parent;
    // Collect names of all direct-child folders of the note's parent folder
    const siblingFolderNames: string[] = (noteParent?.children ?? [])
      .filter((f): f is TFolder => f instanceof TFolder)
      .map((f) => f.name);

    const priorityList = parseSmartFolderNames(this.settings.smartFolderNames);
    const folderPath = resolveSmartAttachmentFolder(
      activeFile.path,
      siblingFolderNames,
      priorityList
    );

    // Ensure the resolved folder exists before writing into it
    if (folderPath) {
      try {
        await this.app.vault.createFolder(folderPath);
      } catch {
        // folder already exists — safe to ignore
      }
    }

    const candidatePath = folderPath ? normalizePath(`${folderPath}/${filename}`) : filename;
    // Use the vault adapter to find a unique path (avoid overwriting existing files)
    let dest = candidatePath;
    const dotIdx = filename.lastIndexOf('.');
    const stem = dotIdx !== -1 ? filename.slice(0, dotIdx) : filename;
    const ext  = dotIdx !== -1 ? filename.slice(dotIdx)    : '';
    let attempt = 0;
    while (await this.app.vault.adapter.exists(dest)) {
      attempt++;
      const unique = folderPath
        ? normalizePath(`${folderPath}/${stem} ${attempt}${ext}`)
        : `${stem} ${attempt}${ext}`;
      dest = unique;
    }

    return dest;
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
        await this.app.vault.process(md, (content: string) => {
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
        await this.app.vault.process(md, (content: string) => {
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

  // Declarative settings definition for Obsidian 1.13+ settings search.
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Debug logging',
        desc: 'Log detailed plugin activity to the browser console (open devtools → console).',
        control: {
          type: 'toggle',
          key: 'debugEnabled',
          defaultValue: false,
        },
      },
      {
        name: 'Smart attachment folder',
        desc: 'When enabled, pasted images are saved to the first matching sibling folder from the priority list instead of the global attachment folder.',
        control: {
          type: 'toggle',
          key: 'smartAttachmentFolder',
          defaultValue: false,
        },
      },
      {
        name: 'Smart folder names',
        desc: 'Comma-separated list of sibling folder names to check (in priority order). Only used when Smart attachment folder is on.',
        control: {
          type: 'text',
          key: 'smartFolderNames',
          defaultValue: 'assets, images',
        },
      },
    ];
  }

  // getControlValue / setControlValue are inherited from PluginSettingTab and
  // read/write this.plugin.settings automatically via the key field above.

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Debug logging')
      .setDesc('Log detailed plugin activity to the browser console (open devtools → console).')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugEnabled)
          .onChange(async (value) => {
            this.plugin.settings.debugEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    // Keep a reference to the folder-names setting so the toggle can update its disabled state.
    let folderNamesSetting: Setting | null = null;

    new Setting(containerEl)
      .setName('Smart attachment folder')
      .setDesc(
        'When enabled, pasted images are saved to the first folder in the priority list ' +
        "that already exists as a sibling of the active note's folder. " +
        'If none exists, images are saved into the note\'s own folder. ' +
        'When disabled (default), Obsidian\'s global attachment folder setting is used.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.smartAttachmentFolder)
          .onChange(async (value) => {
            this.plugin.settings.smartAttachmentFolder = value;
            await this.plugin.saveSettings();
            folderNamesSetting?.setDisabled(!value);
          })
      );

    folderNamesSetting = new Setting(containerEl)
      .setName('Smart folder names')
      .setDesc(
        'Comma-separated priority list of sibling folder names to check (e.g. "assets, images"). ' +
        'Matching is case-sensitive. Only takes effect when Smart attachment folder is on.'
      )
      .setDisabled(!this.plugin.settings.smartAttachmentFolder)
      .addText((text) =>
        text
          .setPlaceholder('Assets, images')
          .setValue(this.plugin.settings.smartFolderNames)
          .onChange(async (value) => {
            this.plugin.settings.smartFolderNames = value;
            await this.plugin.saveSettings();
          })
      );
  }
}