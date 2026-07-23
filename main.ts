import { Plugin, PluginSettingTab, Setting, SettingDefinitionItem, TFile, TFolder, normalizePath, Editor, Notice, EventRef, EmbedCache, LinkCache } from 'obsidian';
import { applyLinkReplacements, rewriteRef, snapshotCandidates, encodeMarkdownPath, mimeSubtypeToExtension, parseSmartFolderNames, resolveSmartAttachmentFolder, findCandidateSourcePaths, createRetryTask, advanceRetryTask, retryTaskKey, mergeSettings } from './src/utils';
import type { RetryTaskState } from './src/utils';

interface ImageLinkUpdaterSettings {
  debugEnabled: boolean;
  smartAttachmentFolder: boolean;
  smartFolderNames: string;
}

const DEFAULT_SETTINGS: ImageLinkUpdaterSettings = {
  debugEnabled: false,
  smartAttachmentFolder: true,   // enabled by default for new installs
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
 */
export default class ImageLinkUpdaterPlugin extends Plugin {
  private cutFiles: TFile[] = [];
  settings: ImageLinkUpdaterSettings = { ...DEFAULT_SETTINGS };

  private pendingRetries = new Map<string, {
    state: RetryTaskState;
    resolvedRef: EventRef | null;
    changedRef: EventRef | null;
    deadlineTimer: number | null;
  }>();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ImageLinkUpdaterSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile && this.isImage(file)) {
          this.logDebug('rename event', { oldPath, newPath: file.path });
          await this.updateImageLinks(oldPath, file.path);
        }
      })
    );

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on('create', async (file) => {
          if (file instanceof TFile && this.isImage(file)) {
            this.logDebug('create event', { path: file.path });
            const resolved = await this.tryApplyByFilename(file.name, file.path, {});
            if (!resolved) {
              this.enqueueRetry(file.name, file.path);
            }
          }
        })
      );
    });

    this.registerEvent(
      this.app.workspace.on('editor-paste', async (evt: ClipboardEvent, editor: Editor) => {
        if (evt.defaultPrevented) return;
        const items = evt?.clipboardData?.items ? Array.from(evt.clipboardData.items) : [];
        const imageItems = items.filter((i) => i.kind === 'file' && i.type?.startsWith('image/'));
        if (imageItems.length === 0) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        evt.preventDefault();

        for (const item of imageItems) {
          const blob = item.getAsFile();
          if (!blob) continue;
          const ext = mimeSubtypeToExtension(blob.type.split('/')[1] || 'png');
          const base = `Pasted image ${this.timestamp()}`;
          const filename = `${base}.${ext}`;

          let dest: string;
          if (this.settings.smartAttachmentFolder) {
            dest = await this.resolveSmartDest(filename, activeFile);
          } else {
            dest = normalizePath(
              await this.app.fileManager.getAvailablePathForAttachment(filename, activeFile.path)
            );
          }

          const arrayBuf = await blob.arrayBuffer();
          const written = await this.createBinaryWithRetry(dest, arrayBuf);
          const mdPath = encodeMarkdownPath(this.ensureLeadingSlash(written));
          editor.replaceSelection(`![](${mdPath})`);
          this.logDebug('pasted image ->', written);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        const selectedFiles = files.filter((f): f is TFile => f instanceof TFile);
        if (selectedFiles.length > 0) {
          menu.addItem((item) => {
            const label = selectedFiles.length === 1 ? 'Cut file' : `Cut ${selectedFiles.length} files`;
            item.setTitle(label).setIcon('cut').onClick(() => {
              this.cutFiles = selectedFiles;
              new Notice(`${label} to clipboard`);
            });
          });
        }

        const targetFolder = files.find((f): f is TFolder => f instanceof TFolder);
        if (targetFolder && this.cutFiles.length > 0) {
          menu.addItem((item) => {
            const label = this.cutFiles.length === 1 ? 'Paste file' : `Paste ${this.cutFiles.length} files`;
            item.setTitle(label).setIcon('paste').onClick(async () => {
              const filesToMove = [...this.cutFiles];
              this.cutFiles = [];
              for (const file of filesToMove) {
                const targetPath = normalizePath(`${targetFolder.path}/${file.name}`);
                await this.renameWithRetry(file, targetPath);
              }
              new Notice(label + ' moved');
            });
          });
        }
      })
    );
  }

  onunload() {
    this.cancelAllRetries();
  }

  private isImage(file: TFile): boolean {
    const ext = file.extension.toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(ext);
  }

  private logDebug(msg: string, ...args: unknown[]) {
    if (this.settings.debugEnabled) {
      console.debug(`[ImageLinkUpdater] ${msg}`, ...args);
    }
  }

  private ensureLeadingSlash(path: string): string {
    const normalized = normalizePath(path);
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  private async updateImageLinks(oldPath: string, newPath: string) {
    const oldFileName = oldPath.split('/').pop() ?? '';
    const abs = this.ensureLeadingSlash(newPath);
    const cache = this.app.metadataCache;

    const candidatesMap = snapshotCandidates(oldPath, newPath, cache.resolvedLinks, cache.unresolvedLinks);
    const proofMap: Record<string, number> = {};
    for (const [p, proof] of candidatesMap.entries()) proofMap[p] = proof.expectedOldCount;

    for (const [sourcePath, proof] of candidatesMap.entries()) {
      const md = this.app.vault.getFileByPath(sourcePath);
      if (!md) continue;

      let allResolved = true;
      try {
        await this.app.vault.process(md, (content: string) => {
          let updated = content;
          const fileCache = cache.getFileCache(md);
          const allRefs: (EmbedCache | LinkCache)[] = [
            ...(fileCache?.embeds ?? []),
            ...(fileCache?.links ?? []),
          ].sort((a, b) => b.position.start.offset - a.position.start.offset);

          const unresolvedRefs = allRefs.filter(r => {
            const path = r.link.split(/[#|]/)[0];
            const isMatch = path === oldFileName || path === encodeURI(oldFileName);
            return isMatch && !cache.getFirstLinkpathDest(path, md.path);
          });

          for (const ref of allRefs) {
            const linkPath = ref.link.split(/[#|]/)[0];
            const dest = cache.getFirstLinkpathDest(linkPath, md.path);
            const start = ref.position.start.offset;
            const end = ref.position.end.offset;
            const originalText = updated.slice(start, end);

            if (dest?.path === newPath) {
              if (originalText.includes(linkPath)) {
                updated = updated.slice(0, start) + rewriteRef(originalText, abs) + updated.slice(end);
              }
              continue;
            }
            if (dest) continue;

            const isOldName = linkPath === oldFileName || linkPath === encodeURI(oldFileName);
            if (isOldName) {
              if (proof.expectedOldCount > 0 && unresolvedRefs.length === proof.expectedOldCount) {
                updated = updated.slice(0, start) + rewriteRef(originalText, abs) + updated.slice(end);
              } else if (proof.expectedOldCount > 0) {
                allResolved = false;
              }
            }
          }
          updated = applyLinkReplacements(updated, oldPath, oldFileName, abs);
          return updated;
        });
      } catch (err) {
        console.error('[ImageLinkUpdater] Failed to update links in', md.path, err);
      }
      if (!allResolved) this.enqueueRetry(oldFileName, newPath, proofMap);
    }
  }

  private async tryApplyByFilename(fileName: string, newPath: string, proofMap: Record<string, number>): Promise<boolean> {
    const abs = this.ensureLeadingSlash(newPath);
    const cache = this.app.metadataCache;
    const cBroken = findCandidateSourcePaths(fileName, {}, cache.unresolvedLinks);
    const candidates = [...new Set([...cBroken, ...Object.keys(proofMap)])];

    let totalResolved = true;
    for (const sourcePath of candidates) {
      const md = this.app.vault.getFileByPath(sourcePath);
      if (!md) continue;
      const expectedOldCount = proofMap[sourcePath] ?? 0;
      try {
        await this.app.vault.process(md, (content: string) => {
          let updated = content;
          const fileCache = cache.getFileCache(md);
          const allRefs = [...(fileCache?.embeds ?? []), ...(fileCache?.links ?? [])]
            .sort((a, b) => b.position.start.offset - a.position.start.offset);
          const unresolvedRefs = allRefs.filter(r => {
            const p = r.link.split(/[#|]/)[0];
            return (p === fileName || p === encodeURI(fileName)) && !cache.getFirstLinkpathDest(p, md.path);
          });
          for (const ref of allRefs) {
            const linkPath = ref.link.split(/[#|]/)[0];
            const dest = cache.getFirstLinkpathDest(linkPath, md.path);
            const start = ref.position.start.offset;
            const end = ref.position.end.offset;
            const originalText = updated.slice(start, end);
            if (dest?.path === newPath) {
              updated = updated.slice(0, start) + rewriteRef(originalText, abs) + updated.slice(end);
            } else if (!dest && (linkPath === fileName || linkPath === encodeURI(fileName))) {
              if (expectedOldCount > 0 && unresolvedRefs.length === expectedOldCount) {
                updated = updated.slice(0, start) + rewriteRef(originalText, abs) + updated.slice(end);
              } else if (expectedOldCount > 0) totalResolved = false;
            }
          }
          return updated;
        });
      } catch (e) { console.error(e); }
    }
    return totalResolved;
  }

  private enqueueRetry(fileName: string, newPath: string, sourceProofMap: Record<string, number> = {}) {
    const key = retryTaskKey(fileName, newPath);
    this.cancelRetryByKey(key);
    const state = createRetryTask(fileName, newPath, Date.now(), sourceProofMap);
    const entry = { state, resolvedRef: null as EventRef | null, changedRef: null as EventRef | null, deadlineTimer: null as number | null };
    const cleanup = () => this.cancelRetryByKey(key);
    const onEvent = async () => {
      const current = this.pendingRetries.get(key);
      if (!current) return;
      const next = advanceRetryTask(current.state, Date.now());
      if (!next) {
        cleanup();
        new Notice(`Image Link Updater: Gave up updating links for ${fileName}`);
        return;
      }
      current.state = next;
      if (await this.tryApplyByFilename(fileName, newPath, current.state.sourceProofMap)) cleanup();
    };
    entry.deadlineTimer = window.setTimeout(cleanup, state.deadlineMs - Date.now());
    entry.resolvedRef = this.app.metadataCache.on('resolved', onEvent);
    entry.changedRef = this.app.metadataCache.on('changed', onEvent);
    this.pendingRetries.set(key, entry);
  }

  private cancelRetryByKey(key: string) {
    const entry = this.pendingRetries.get(key);
    if (!entry) return;
    if (entry.resolvedRef) this.app.metadataCache.offref(entry.resolvedRef);
    if (entry.changedRef) this.app.metadataCache.offref(entry.changedRef);
    if (entry.deadlineTimer !== null) window.clearTimeout(entry.deadlineTimer);
    this.pendingRetries.delete(key);
  }

  private cancelAllRetries() {
    for (const key of this.pendingRetries.keys()) this.cancelRetryByKey(key);
  }

  private timestamp(): string {
    const d = new Date();
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  private async createBinaryWithRetry(targetPath: string, data: ArrayBuffer): Promise<string> {
    const dotIdx = targetPath.lastIndexOf('.');
    const stem = dotIdx !== -1 ? targetPath.slice(0, dotIdx) : targetPath;
    const ext = dotIdx !== -1 ? targetPath.slice(dotIdx) : '';
    let candidate = targetPath;
    let attempt = 0;
    while (true) {
      try {
        await this.app.vault.createBinary(candidate, data);
        return candidate;
      } catch {
        attempt++;
        candidate = normalizePath(`${stem} ${attempt}${ext}`);
      }
    }
  }

  private async renameWithRetry(file: TFile, targetPath: string): Promise<void> {
    const dotIdx = targetPath.lastIndexOf('.');
    const stem = dotIdx !== -1 ? targetPath.slice(0, dotIdx) : targetPath;
    const ext = dotIdx !== -1 ? targetPath.slice(dotIdx) : '';
    let candidate = targetPath;
    let attempt = 0;
    while (true) {
      try {
        await this.app.fileManager.renameFile(file, candidate);
        return;
      } catch {
        attempt++;
        candidate = normalizePath(`${stem} ${attempt}${ext}`);
      }
    }
  }

  private async resolveSmartDest(filename: string, activeFile: TFile): Promise<string> {
    const siblingFolders: string[] = (activeFile.parent?.children ?? [])
      .filter((f): f is TFolder => f instanceof TFolder)
      .map((f) => f.name);
    const priorityList = parseSmartFolderNames(this.settings.smartFolderNames);
    const folder = resolveSmartAttachmentFolder(activeFile.path, siblingFolders, priorityList);
    return normalizePath(`${folder}/${filename}`);
  }

  async loadSettings() {
    const data = (await this.loadData()) as Partial<ImageLinkUpdaterSettings> | null;
    this.settings = mergeSettings(DEFAULT_SETTINGS, data);
  }
  async saveSettings() { await this.saveData(this.settings); }
}

class ImageLinkUpdaterSettingTab extends PluginSettingTab {
  constructor(app: import('obsidian').App, private plugin: ImageLinkUpdaterPlugin) { super(app, plugin); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { name: 'Debug logging', desc: 'Log detailed plugin activity.', control: { type: 'toggle', key: 'debugEnabled', defaultValue: false } },
      { name: 'Smart attachment folder', desc: 'Save pasted images to sibling folders.', control: { type: 'toggle', key: 'smartAttachmentFolder', defaultValue: true } },
      { name: 'Smart folder names', desc: 'Priority list of folder names.', control: { type: 'text', key: 'smartFolderNames', defaultValue: 'assets, images' } }
    ];
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName('Debug logging').addToggle(t => t.setValue(this.plugin.settings.debugEnabled).onChange(async v => { this.plugin.settings.debugEnabled = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Smart attachment folder').addToggle(t => t.setValue(this.plugin.settings.smartAttachmentFolder).onChange(async v => { this.plugin.settings.smartAttachmentFolder = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Smart folder names').addText(t => t.setValue(this.plugin.settings.smartFolderNames).onChange(async v => { this.plugin.settings.smartFolderNames = v; await this.plugin.saveSettings(); }));
  }
}
