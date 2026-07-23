/**
 * Pure utility functions extracted from main.ts for testability.
 * None of these functions depend on the Obsidian runtime.
 */

/**
 * Merge saved plugin data onto a set of defaults, returning a complete settings object.
 *
 * Behaviour (matches Obsidian's loadData/saveData contract):
 *   - New install / no saved data (null/undefined) → all defaults apply.
 *   - Saved data present → explicit saved values override defaults; unrecognised
 *     keys are ignored (Object.assign semantics, safe forward-compatibility).
 *
 * Extracted as a pure function so unit tests can verify the default-on flip for
 * smartAttachmentFolder without booting the Obsidian runtime.
 */
export function mergeSettings<T extends object>(defaults: T, saved: Partial<T> | null | undefined): T {
  return Object.assign({}, defaults, saved ?? {});
}

/**
 * Types for MetadataCache link maps (mirrors Obsidian's public API shape).
 * Using plain object types keeps this module free of the Obsidian runtime.
 */
export type ResolvedLinkMap   = Record<string, Record<string, number>>;
export type UnresolvedLinkMap = Record<string, Record<string, number>>;

export interface SourceProof {
  /** 
   * How many times this source referenced the EXACT oldPath before rename.
   * Established from resolvedLinks snapshot.
   */
  readonly expectedOldCount: number;
}

/**
 * S0 Snapshot: Find all candidate sources and their proof counts.
 */
export function snapshotCandidates(
  oldPath: string,
  newPath: string,
  resolvedLinks: ResolvedLinkMap,
  unresolvedLinks: UnresolvedLinkMap
): Map<string, SourceProof> {
  const map = new Map<string, SourceProof>();
  
  const oldName = oldPath.split('/').pop() ?? oldPath;
  const oldNameEnc = encodeURI(oldName);

  // Helper to add or update proof
  const ensureProof = (path: string, count = 0) => {
    if (!map.has(path)) map.set(path, { expectedOldCount: count });
  };

  // Pass 1: resolvedLinks (Targets oldPath or newPath)
  for (const [source, targets] of Object.entries(resolvedLinks)) {
    const oldCount = targets[oldPath] ?? 0;
    const newCount = targets[newPath] ?? 0;
    if (oldCount > 0 || newCount > 0) {
      map.set(source, { expectedOldCount: oldCount });
    }
  }

  // Pass 2: unresolvedLinks (Targets oldPath, oldName, or encoded oldName)
  for (const [source, targets] of Object.entries(unresolvedLinks)) {
    for (const key of Object.keys(targets)) {
      if (key === oldPath || key === oldName || key === oldNameEnc || 
          key.endsWith(`/${oldName}`) || key.endsWith(`/${oldNameEnc}`)) {
        ensureProof(source);
        break;
      }
    }
  }

  return map;
}

/**
 * Find all Markdown source paths that reference the given image.
 * API Compatibility wrapper for existing tests.
 */
export function findCandidateSourcePaths(
  imagePath: string,
  resolvedLinks: ResolvedLinkMap,
  unresolvedLinks: UnresolvedLinkMap
): string[] {
  // Use snapshotCandidates for a single target (treating it as oldPath)
  const map = snapshotCandidates(imagePath, '', resolvedLinks, unresolvedLinks);
  return [...map.keys()].sort();
}

/**
 * Parse a comma-separated folder priority list into a clean ordered array.
 * Trims whitespace from each entry; ignores empty entries.
 */
export function parseSmartFolderNames(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve the destination folder for a pasted image when Smart attachment folder is ON.
 *
 * Algorithm:
 *   1. Walk the priority list in order.
 *   2. Return the first entry whose name EXACTLY matches a folder that is a direct
 *      child of the note's parent folder (i.e. a sibling of the note).
 *   3. If none match, return the note's parent folder path directly.
 *
 * Case-sensitivity: matches are case-sensitive because Obsidian vault paths are
 * case-sensitive on macOS (default HFS+ case-insensitive, but APFS and most other
 * platforms are case-sensitive), and Obsidian's own path APIs treat paths as
 * case-sensitive. Using case-sensitive matching is the safe, predictable default —
 * a user who names their folder "Assets" and lists "assets" in the priority list will
 * see the fallback behaviour and can correct their list.
 *
 * @param notePath       - Vault-root path of the active note, e.g. "Docs/notes/my-note.md"
 * @param siblingFolders - Names of all direct-child folders of the note's parent,
 *                         e.g. ["assets", "images", "drafts"]
 * @param priorityList   - Ordered list of candidate folder names to probe, e.g. ["assets", "images"]
 * @returns              - Vault-root folder path to save into (no trailing slash),
 *                         e.g. "Docs/notes/assets" or "Docs/notes" (fallback)
 */
export function resolveSmartAttachmentFolder(
  notePath: string,
  siblingFolders: string[],
  priorityList: string[]
): string {
  // Derive the parent folder of the note (empty string means vault root)
  const lastSlash = notePath.lastIndexOf('/');
  const noteParent = lastSlash === -1 ? '' : notePath.slice(0, lastSlash);

  const siblingSet = new Set(siblingFolders);

  for (const candidate of priorityList) {
    if (siblingSet.has(candidate)) {
      return noteParent ? `${noteParent}/${candidate}` : candidate;
    }
  }

  // Fallback: note's parent folder
  return noteParent;
}

/** Escape regex metacharacters in a string. */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Map a MIME subtype to a clean file extension.
 * Handles edge cases like "svg+xml" → "svg", "jpeg" → "jpg", etc.
 */
export function mimeSubtypeToExtension(mimeSubtype: string): string {
  const s = mimeSubtype.toLowerCase();
  if (s === 'svg+xml') return 'svg';
  if (s === 'jpeg') return 'jpg';
  if (s === 'tiff') return 'tif';
  if (s === 'x-png') return 'png';
  return s;
}

/**
 * Encode a vault-absolute path for use in a Markdown image link.
 * Standard encodeURI PLUS encodes parentheses which break Markdown link syntax.
 */
export function encodeMarkdownPath(path: string): string {
  return encodeURI(path).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Ensure a path starts with `/`.
 */
export function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Returns true if the character at `index` in `content` is inside a fenced code block.
 */
export function isInCodeRegion(content: string, index: number): boolean {
  const before = content.slice(0, index);
  let count = 0;
  let pos = 0;
  while (pos < before.length) {
    const lineEnd = before.indexOf('\n', pos);
    const line = lineEnd === -1 ? before.slice(pos) : before.slice(pos, lineEnd);
    if (line.startsWith('```')) count++;
    pos = lineEnd === -1 ? before.length : lineEnd + 1;
  }
  return count % 2 !== 0;
}

/**
 * Build replacement regexes for a rename operation (Strict Phase 1).
 * Only matches exact full paths (raw or encoded).
 */
export function buildStrictFullMatchPatterns(oldPath: string) {
  const p = oldPath.startsWith('/') ? oldPath.slice(1) : oldPath;
  const escapedP = escapeRegExp(p);
  const escapedPEnc = escapeRegExp(encodeURI(p));

  const pathPattern = `(?:/?${escapedP}|/?${escapedPEnc})`;
  const titleCapture = String.raw`(?:\s+"((?:[^"\\]|\\.)*)")?`;

  const mdFull = new RegExp(
    String.raw`!\[(.*?)\]\(<?${pathPattern}>?${titleCapture}\)`,
    'gi'
  );

  const wikiFull = new RegExp(
    String.raw`!\[\[${pathPattern}((?:[#|][^\]]*)?)\]\]`,
    'gi'
  );

  return { mdFull, wikiFull };
}

/**
 * Apply link replacements to file content for Phase 1 (Strict Exact Path).
 * This phase does not require metadata cache target resolution.
 */
export function applyLinkReplacements(
  content: string,
  oldPath: string,
  _oldFileName: string, // Kept for API compatibility with existing tests
  newAbsPath: string
): string {
  const absMd = encodeMarkdownPath(newAbsPath);
  const { mdFull, wikiFull } = buildStrictFullMatchPatterns(oldPath);

  function safeReplace(
    text: string,
    pattern: RegExp,
    replacer: (...args: unknown[]) => string
  ): string {
    return text.replace(pattern, (...args: unknown[]) => {
      const offset = args[args.length - 2] as number;
      if (isInCodeRegion(text, offset)) return args[0] as string;
      return replacer(...args);
    });
  }

  let updated = content;

  // mdFull replacement
  updated = safeReplace(updated, mdFull, (...args) => {
    const alt = (args[1] as string | undefined) ?? '';
    const title = args[2] as string | undefined;
    const titleSuffix = title !== undefined ? ` "${title}"` : '';
    return `![${alt}](${absMd}${titleSuffix})`;
  });

  // wikiFull replacement
  updated = safeReplace(updated, wikiFull, (...args) => {
    const suffix = (args[1] as string | undefined) ?? '';
    return `![[${newAbsPath}${suffix}]]`;
  });

  return updated;
}

/**
 * S1/S2 surgical link rewrite.
 * Preserves Markdown title/alt and Wiki alias/heading.
 */
export function rewriteRef(
  originalText: string,
  newAbsPath: string
): string {
  const absMd = encodeMarkdownPath(newAbsPath);
  
  // Markdown link pattern: exclude space and quotes from path group
  const mdRegex = /!\[(.*?)\]\(<?([^>\s"]+)>?(\s+"(?:[^"\\]|\\.)*")?\)/i;
  const mdMatch = originalText.match(mdRegex);
  if (mdMatch) {
    const alt = mdMatch[1];
    const title = mdMatch[3] ?? '';
    return `![${alt}](${absMd}${title})`;
  }

  // Wiki embed pattern
  const wikiRegex = /!\[\[([^|#\]]+)((?:[#|][^\]]*)?)\]\]/i;
  const wikiMatch = originalText.match(wikiRegex);
  if (wikiMatch) {
    const suffix = wikiMatch[2];
    return `![[${newAbsPath}${suffix}]]`;
  }

  return originalText;
}

// Metadata-cache retry helpers
export interface RetryTaskState {
  readonly fileName: string;
  readonly newPath: string;
  readonly attempts: number;
  readonly deadlineMs: number;   // absolute epoch ms after which we give up
  /** 
   * Captured snapshot of expected reference counts per source file.
   * Required for target-proof fallback during retry events.
   */
  readonly sourceProofMap: Record<string, number>;
}

export const RETRY_MAX_ATTEMPTS = 5;
export const RETRY_DEADLINE_MS = 10_000;

/**
 * Create the initial retry task state.
 */
export function createRetryTask(
  fileName: string,
  newPath: string,
  nowMs: number,
  sourceProofMap: Record<string, number> = {}
): RetryTaskState {
  return {
    fileName,
    newPath,
    attempts: 0,
    deadlineMs: nowMs + RETRY_DEADLINE_MS,
    sourceProofMap
  };
}

/**
 * Returns whether a retry should proceed, and the advanced state to store.
 *
 * Decision:
 *   - If attempts >= RETRY_MAX_ATTEMPTS → give up (return null).
 *   - If nowMs >= deadlineMs            → give up (return null).
 *   - Otherwise: increment attempts and return updated state.
 */
export function advanceRetryTask(
  task: RetryTaskState,
  nowMs: number
): RetryTaskState | null {
  if (task.attempts >= RETRY_MAX_ATTEMPTS) return null;
  if (nowMs >= task.deadlineMs) return null;
  return { ...task, attempts: task.attempts + 1 };
}

/**
 * Compute the Map key for a retry task.
 * Uses NUL (\0) as a separator — a character that never appears in vault paths —
 * so "A/img.png" + "B/img.png" and "A/img.png" + "A/img.png" produce distinct keys.
 * Two tasks are the same iff both fileName AND newPath are identical.
 */
export function retryTaskKey(fileName: string, newPath: string): string {
  return `${fileName}\0${newPath}`;
}
