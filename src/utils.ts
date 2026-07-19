/**
 * Pure utility functions extracted from main.ts for testability.
 * None of these functions depend on the Obsidian runtime.
 */

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
 * Build replacement regexes for a rename operation.
 *
 * Strategy:
 *  - mdFull:    matches by full path (raw or encoded). Runs first.
 *  - mdByName:  matches by filename ONLY when preceded by / or start-of-URL
 *               (so "a.png" ≠ "data.png", and won't re-match a full path that
 *               mdFull already rewrote to the new absolute path).
 *  - wikiFull / wikiByName: same strategy for wiki embeds.
 *
 * All markdown patterns capture an optional title attribute (M5).
 * Wiki patterns capture and preserve alias/heading suffixes (H2).
 */
export function buildRenamePatterns(oldPath: string, oldFileName: string) {
  const oldPathNorm = oldPath.startsWith('/') ? oldPath.slice(1) : oldPath;
  const oldPathEnc = encodeURI(oldPathNorm);
  const oldNameEnc = encodeURI(oldFileName);

  const escapedOldPath = escapeRegExp(oldPathNorm);
  const escapedOldPathEnc = escapeRegExp(oldPathEnc);
  const escapedOldName = escapeRegExp(oldFileName);
  const escapedOldNameEnc = escapeRegExp(oldNameEnc);

  // Title capture group — reusable source fragment
  // Matches optional `  "title"` before the closing `)`
  const titleCapture = String.raw`(?:\s+"((?:[^"\\]|\\.)*)")?`;

  // Markdown full-path match (raw OR encoded), with optional leading /.
  // Group 1: alt text, Group 2: optional title
  const mdFull = new RegExp(
    String.raw`!\[(.*?)\]\(<?(?:/?${escapedOldPath}|/?${escapedOldPathEnc})>?${titleCapture}\)`,
    'gi'
  );

  // Markdown filename-only match: the filename must be the ENTIRE url path component
  // (preceded by ( or < or / — i.e. no other path segment characters after the last /).
  // This prevents re-matching after mdFull already rewrote the link to the new absolute path.
  // Group 1: alt text, Group 2: optional title
  const mdByName = new RegExp(
    String.raw`!\[(.*?)\]\(<?(?:[^)]*\/)?(?:${escapedOldName}|${escapedOldNameEnc})>?${titleCapture}\)`,
    'gi'
  );

  // Wiki embeds: full path — capture alias/heading suffix (H2)
  const wikiFull = new RegExp(
    String.raw`!\[\[(?:[^\]]*\/)?${escapedOldPath}((?:[#|][^\]]*)?)\]\]`,
    'gi'
  );

  // Wiki embeds: filename — capture alias/heading suffix (H2)
  // Anchored: filename preceded by / or at start of link content
  const wikiByName = new RegExp(
    String.raw`!\[\[(?:[^\]]*\/)?(?:${escapedOldName}|${escapedOldNameEnc})((?:[#|][^\]]*)?)\]\]`,
    'gi'
  );

  return { mdFull, mdByName, wikiFull, wikiByName };
}

/**
 * Apply link replacements to file content, skipping fenced code regions.
 *
 * Runs mdFull first, then mdByName — but mdByName is guarded so it won't
 * re-match links that mdFull already rewrote (the new path differs from old).
 *
 * Returns the updated content string.
 */
export function applyLinkReplacements(
  content: string,
  oldPath: string,
  oldFileName: string,
  newAbsPath: string   // vault-root absolute path (with leading /)
): string {
  const absMd = encodeMarkdownPath(newAbsPath);
  const { mdFull, mdByName, wikiFull, wikiByName } = buildRenamePatterns(oldPath, oldFileName);

  // In String.prototype.replace callbacks the full parameter list is:
  //   (fullMatch, ...captureGroups, matchOffset, fullString)
  // The offset is at args[args.length - 2].
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

  // Pass 1: mdFull — exact full-path match (raw or encoded).
  updated = safeReplace(updated, mdFull, (...args) => {
    const alt = (args[1] as string | undefined) ?? '';
    const title = args[2] as string | undefined;
    const titleSuffix = title !== undefined ? ` "${title}"` : '';
    return `![${alt}](${absMd}${titleSuffix})`;
  });

  // Pass 2: mdByName — fallback filename-only match, applied to the already-updated
  // string. Guard: skip any match that already points to the new absolute path
  // (meaning pass 1 already rewrote it and the filename still appears in the new path).
  updated = updated.replace(mdByName, (...args: unknown[]) => {
    const offset = args[args.length - 2] as number;
    const match = args[0] as string;
    if (isInCodeRegion(updated, offset)) return match;
    const newPathEnc = encodeMarkdownPath(newAbsPath);
    if (match.includes(newPathEnc) || match.includes(newAbsPath)) return match;
    const alt = (args[1] as string | undefined) ?? '';
    const title = args[2] as string | undefined;
    const titleSuffix = title !== undefined ? ` "${title}"` : '';
    return `![${alt}](${absMd}${titleSuffix})`;
  });

  // Wiki embeds
  updated = safeReplace(updated, wikiFull, (...args) => {
    const suffix = (args[1] as string | undefined) ?? '';
    return `![[${newAbsPath}${suffix}]]`;
  });

  updated = safeReplace(updated, wikiByName, (...args) => {
    const match = args[0] as string;
    // Skip if already pointing to the new path
    if (match.includes(newAbsPath)) return match;
    const suffix = (args[1] as string | undefined) ?? '';
    return `![[${newAbsPath}${suffix}]]`;
  });

  return updated;
}
