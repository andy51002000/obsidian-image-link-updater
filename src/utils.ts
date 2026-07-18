/**
 * Pure utility functions extracted from main.ts for testability.
 * None of these functions depend on the Obsidian runtime.
 */

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

  // Track which character ranges have been replaced to prevent double-rewriting.
  // We rebuild the string manually for the two-pass md approach.
  const replacedRanges: Array<[number, number]> = [];

  function isAlreadyReplaced(offset: number, length: number): boolean {
    return replacedRanges.some(([start, end]) => offset < end && offset + length > start);
  }

  let updated = content;

  // Pass 1: mdFull — exact path match
  updated = content.replace(mdFull, (...args: unknown[]) => {
    const offset = args[args.length - 2] as number;
    const match = args[0] as string;
    if (isInCodeRegion(content, offset)) return match;
    const alt = (args[1] as string | undefined) ?? '';
    const title = args[2] as string | undefined;
    const titleSuffix = title !== undefined ? ` "${title}"` : '';
    const replacement = `![${alt}](${absMd}${titleSuffix})`;
    replacedRanges.push([offset, offset + match.length]);
    return replacement;
  });

  // Pass 2: mdByName — fallback filename match, skip already-replaced ranges
  // We need to operate on the original content to get correct offsets.
  const afterByName = content.replace(mdByName, (...args: unknown[]) => {
    const offset = args[args.length - 2] as number;
    const match = args[0] as string;
    if (isInCodeRegion(content, offset)) return match;
    if (isAlreadyReplaced(offset, match.length)) return match;
    const alt = (args[1] as string | undefined) ?? '';
    const title = args[2] as string | undefined;
    const titleSuffix = title !== undefined ? ` "${title}"` : '';
    return `![${alt}](${absMd}${titleSuffix})`;
  });

  // Merge: use mdFull results for replaced ranges, mdByName for everything else.
  // Simpler approach: re-apply mdByName on top of the mdFull result, but guard with
  // the new absolute path so it won't match the already-replaced links.
  // Since mdByName matches `photo.png` and the new path also contains `photo.png`,
  // we must prevent re-matching. We do this by checking if the match was in a range
  // that was already replaced in pass 1 — but now `updated` has different offsets.
  //
  // The cleanest solution: apply mdByName to `updated` (post-mdFull) but exclude
  // any match whose full-URL part is the new absolute path (already correct).
  updated = updated.replace(mdByName, (...args: unknown[]) => {
    const offset = args[args.length - 2] as number;
    const match = args[0] as string;
    if (isInCodeRegion(updated, offset)) return match;
    // If the match already contains the new absolute path, skip it.
    const newPathEsc = encodeMarkdownPath(newAbsPath);
    if (match.includes(newPathEsc) || match.includes(newAbsPath)) return match;
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
