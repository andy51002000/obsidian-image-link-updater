import { describe, it, expect } from 'vitest';
import {
  escapeRegExp,
  mimeSubtypeToExtension,
  encodeMarkdownPath,
  ensureLeadingSlash,
  applyLinkReplacements,
  parseSmartFolderNames,
  resolveSmartAttachmentFolder,
  findCandidateSourcePaths,
  createRetryTask,
  advanceRetryTask,
  retryTaskKey,
  mergeSettings,
  RETRY_MAX_ATTEMPTS,
  RETRY_DEADLINE_MS,
} from '../src/utils';
import type { ResolvedLinkMap, UnresolvedLinkMap } from '../src/utils';

// ---------------------------------------------------------------------------
// escapeRegExp
// ---------------------------------------------------------------------------
describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.png')).toBe('a\\.png');
    expect(escapeRegExp('img (1).png')).toBe('img \\(1\\)\\.png');
    expect(escapeRegExp('foo[bar]')).toBe('foo\\[bar\\]');
  });
});

// ---------------------------------------------------------------------------
// mimeSubtypeToExtension — M4
// ---------------------------------------------------------------------------
describe('mimeSubtypeToExtension (M4)', () => {
  it('maps svg+xml to svg', () => {
    expect(mimeSubtypeToExtension('svg+xml')).toBe('svg');
  });
  it('maps jpeg to jpg', () => {
    expect(mimeSubtypeToExtension('jpeg')).toBe('jpg');
  });
  it('maps tiff to tif', () => {
    expect(mimeSubtypeToExtension('tiff')).toBe('tif');
  });
  it('passes through png unchanged', () => {
    expect(mimeSubtypeToExtension('png')).toBe('png');
  });
  it('passes through webp unchanged', () => {
    expect(mimeSubtypeToExtension('webp')).toBe('webp');
  });
});

// ---------------------------------------------------------------------------
// encodeMarkdownPath — H3 (parentheses encoding)
// ---------------------------------------------------------------------------
describe('encodeMarkdownPath (H3)', () => {
  it('encodes spaces', () => {
    expect(encodeMarkdownPath('/attachments/Pasted image 1.png')).toBe(
      '/attachments/Pasted%20image%201.png'
    );
  });
  it('encodes parentheses so markdown is not broken', () => {
    expect(encodeMarkdownPath('/dir/img (1).png')).toBe('/dir/img%20%281%29.png');
  });
  it('leaves forward slashes unencoded', () => {
    expect(encodeMarkdownPath('/a/b/c.png')).toBe('/a/b/c.png');
  });
});

// ---------------------------------------------------------------------------
// ensureLeadingSlash
// ---------------------------------------------------------------------------
describe('ensureLeadingSlash', () => {
  it('adds slash when missing', () => {
    expect(ensureLeadingSlash('foo/bar.png')).toBe('/foo/bar.png');
  });
  it('keeps existing slash', () => {
    expect(ensureLeadingSlash('/foo/bar.png')).toBe('/foo/bar.png');
  });
});

// ---------------------------------------------------------------------------
// applyLinkReplacements — C2: substring isolation
// ---------------------------------------------------------------------------
describe('applyLinkReplacements — C2: filename boundary (substring isolation)', () => {
  const newPath = '/attachments/a.png';

  it('renames exact match "a.png" link', () => {
    const content = '![](attachments/a.png)';
    const result = applyLinkReplacements(content, 'attachments/a.png', 'a.png', newPath);
    expect(result).toContain('/attachments/a.png');
  });

  it('does NOT rewrite "data.png" when renaming "a.png"', () => {
    const content = '![](attachments/data.png)';
    const result = applyLinkReplacements(content, 'attachments/a.png', 'a.png', newPath);
    // Must be unchanged
    expect(result).toBe(content);
  });

  it('does NOT rewrite "banana.png" when renaming "a.png"', () => {
    const content = '![my banana](attachments/banana.png)';
    const result = applyLinkReplacements(content, 'attachments/a.png', 'a.png', newPath);
    expect(result).toBe(content);
  });

  it('does NOT rewrite links when only suffix matches', () => {
    const content = '![](notes/image_a.png)';
    const result = applyLinkReplacements(content, 'attachments/a.png', 'a.png', newPath);
    expect(result).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// applyLinkReplacements — H2: wiki link alias/heading preservation
// ---------------------------------------------------------------------------
describe('applyLinkReplacements — H2: wiki alias/heading preservation', () => {
  const oldPath = 'attachments/diagram.png';
  const newPath = '/attachments/new-folder/diagram.png';

  it('preserves |alias in wiki embed', () => {
    const content = '![[attachments/diagram.png|My Diagram]]';
    const result = applyLinkReplacements(content, oldPath, 'diagram.png', newPath);
    expect(result).toBe('![[/attachments/new-folder/diagram.png|My Diagram]]');
  });

  it('preserves |300 (size) in wiki embed', () => {
    const content = '![[attachments/diagram.png|300]]';
    const result = applyLinkReplacements(content, oldPath, 'diagram.png', newPath);
    expect(result).toBe('![[/attachments/new-folder/diagram.png|300]]');
  });

  it('preserves #heading in wiki embed', () => {
    const content = '![[attachments/diagram.png#section]]';
    const result = applyLinkReplacements(content, oldPath, 'diagram.png', newPath);
    expect(result).toBe('![[/attachments/new-folder/diagram.png#section]]');
  });

  it('handles plain wiki embed (no suffix)', () => {
    const content = '![[attachments/diagram.png]]';
    const result = applyLinkReplacements(content, oldPath, 'diagram.png', newPath);
    expect(result).toBe('![[/attachments/new-folder/diagram.png]]');
  });
});

// ---------------------------------------------------------------------------
// applyLinkReplacements — M5: title attribute preservation
// ---------------------------------------------------------------------------
describe('applyLinkReplacements — M5: markdown title preservation', () => {
  it('preserves title string on markdown image link', () => {
    const content = '![alt](attachments/photo.png "My Title")';
    const result = applyLinkReplacements(
      content,
      'attachments/photo.png',
      'photo.png',
      '/attachments/photo.png'
    );
    expect(result).toBe('![alt](/attachments/photo.png "My Title")');
  });
});

// ---------------------------------------------------------------------------
// applyLinkReplacements — code fence skipping (C3)
// ---------------------------------------------------------------------------
describe('applyLinkReplacements — C3: skip code fences', () => {
  it('does not rewrite links inside fenced code block', () => {
    const content = [
      'Normal text',
      '```',
      '![](attachments/a.png)',
      '```',
      'After fence',
    ].join('\n');
    const result = applyLinkReplacements(content, 'attachments/a.png', 'a.png', '/new/a.png');
    // Link inside fence must be unchanged
    expect(result).toContain('![](attachments/a.png)');
  });

  it('rewrites links outside code fences', () => {
    const content = [
      '![](attachments/a.png)',
      '```',
      'some code',
      '```',
    ].join('\n');
    const result = applyLinkReplacements(content, 'attachments/a.png', 'a.png', '/new/a.png');
    expect(result).toContain('/new/a.png');
  });
});

// ---------------------------------------------------------------------------
// parseSmartFolderNames
// ---------------------------------------------------------------------------
describe('parseSmartFolderNames', () => {
  it('splits comma-separated entries', () => {
    expect(parseSmartFolderNames('assets, images')).toEqual(['assets', 'images']);
  });
  it('trims whitespace from each entry', () => {
    expect(parseSmartFolderNames('  assets , images  ')).toEqual(['assets', 'images']);
  });
  it('ignores empty entries from double commas', () => {
    expect(parseSmartFolderNames('assets,,images')).toEqual(['assets', 'images']);
  });
  it('ignores trailing comma', () => {
    expect(parseSmartFolderNames('assets, images,')).toEqual(['assets', 'images']);
  });
  it('returns empty array for blank string', () => {
    expect(parseSmartFolderNames('')).toEqual([]);
  });
  it('returns empty array for only commas and spaces', () => {
    expect(parseSmartFolderNames(' , , ')).toEqual([]);
  });
  it('handles single entry without comma', () => {
    expect(parseSmartFolderNames('pics')).toEqual(['pics']);
  });
});

// ---------------------------------------------------------------------------
// resolveSmartAttachmentFolder
// ---------------------------------------------------------------------------
describe('resolveSmartAttachmentFolder', () => {
  // Helper: note at Docs/notes/my-note.md with sibling folders
  const notePath = 'Docs/notes/my-note.md';
  const noteParent = 'Docs/notes';

  it('returns first priority match when it exists as a sibling', () => {
    const result = resolveSmartAttachmentFolder(
      notePath,
      ['assets', 'images', 'drafts'],
      ['assets', 'images']
    );
    expect(result).toBe(`${noteParent}/assets`);
  });

  it('first-match wins: picks "assets" over "images" per priority order', () => {
    const result = resolveSmartAttachmentFolder(
      notePath,
      ['assets', 'images'],
      ['assets', 'images']
    );
    expect(result).toBe(`${noteParent}/assets`);
  });

  it('skips first priority and picks second when only second exists', () => {
    const result = resolveSmartAttachmentFolder(
      notePath,
      ['images'],
      ['assets', 'images']
    );
    expect(result).toBe(`${noteParent}/images`);
  });

  it('falls back to note parent folder when no priority match exists', () => {
    const result = resolveSmartAttachmentFolder(
      notePath,
      ['drafts', 'old'],
      ['assets', 'images']
    );
    expect(result).toBe(noteParent);
  });

  it('handles empty sibling list (fallback to note parent)', () => {
    const result = resolveSmartAttachmentFolder(notePath, [], ['assets', 'images']);
    expect(result).toBe(noteParent);
  });

  it('handles empty priority list (always fallback)', () => {
    const result = resolveSmartAttachmentFolder(notePath, ['assets', 'images'], []);
    expect(result).toBe(noteParent);
  });

  it('respects custom priority list "pics, media"', () => {
    const result = resolveSmartAttachmentFolder(
      notePath,
      ['media', 'pics'],
      ['pics', 'media']
    );
    expect(result).toBe(`${noteParent}/pics`);
  });

  it('is case-sensitive: "Assets" does not match priority "assets"', () => {
    const result = resolveSmartAttachmentFolder(
      notePath,
      ['Assets'],
      ['assets', 'images']
    );
    // "Assets" != "assets" — fallback to parent
    expect(result).toBe(noteParent);
  });

  it('handles note at vault root (no parent folder)', () => {
    // Note at vault root: "root-note.md" has no parent directory segment
    const result = resolveSmartAttachmentFolder(
      'root-note.md',
      ['assets'],
      ['assets', 'images']
    );
    // parent is '', sibling path is just 'assets'
    expect(result).toBe('assets');
  });

  it('handles note at vault root with no matching sibling (fallback to empty string)', () => {
    const result = resolveSmartAttachmentFolder(
      'root-note.md',
      ['drafts'],
      ['assets', 'images']
    );
    // parent is '' — fallback is vault root
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// findCandidateSourcePaths — metadata-cache targeted source selection
// ---------------------------------------------------------------------------
describe('findCandidateSourcePaths', () => {
  // Helpers to build link-map fixtures
  const resolved = (entries: Record<string, string[]>): ResolvedLinkMap =>
    Object.fromEntries(
      Object.entries(entries).map(([src, dests]) => [
        src,
        Object.fromEntries(dests.map((d) => [d, 1])),
      ])
    );

  const unresolved = (entries: Record<string, string[]>): UnresolvedLinkMap =>
    Object.fromEntries(
      Object.entries(entries).map(([src, keys]) => [
        src,
        Object.fromEntries(keys.map((k) => [k, 1])),
      ])
    );

  it('finds source via full path in resolvedLinks', () => {
    const r = resolved({ 'notes/note.md': ['attachments/photo.png'] });
    const result = findCandidateSourcePaths('attachments/photo.png', r, {});
    expect(result).toEqual(['notes/note.md']);
  });

  it('finds source via bare filename in unresolvedLinks (OS-move fallback)', () => {
    const u = unresolved({ 'notes/note.md': ['photo.png'] });
    const result = findCandidateSourcePaths('photo.png', {}, u);
    expect(result).toEqual(['notes/note.md']);
  });

  it('finds source via URI-encoded filename in unresolvedLinks', () => {
    const u = unresolved({ 'notes/note.md': ['Pasted%20image.png'] });
    const result = findCandidateSourcePaths('Pasted image.png', {}, u);
    expect(result).toEqual(['notes/note.md']);
  });

  it('finds source via partial-path key ending with /filename in unresolvedLinks', () => {
    const u = unresolved({ 'notes/note.md': ['attachments/photo.png'] });
    const result = findCandidateSourcePaths('photo.png', {}, u);
    expect(result).toEqual(['notes/note.md']);
  });

  it('finds source via full-path key in unresolvedLinks', () => {
    const u = unresolved({ 'notes/note.md': ['attachments/photo.png'] });
    const result = findCandidateSourcePaths('attachments/photo.png', {}, u);
    expect(result).toEqual(['notes/note.md']);
  });

  it('returns both resolved and unresolved candidates, deduplicated', () => {
    const r = resolved({ 'notes/note.md': ['attachments/photo.png'] });
    // Same source also has an unresolved entry for the same file
    const u = unresolved({ 'notes/note.md': ['photo.png'], 'other/other.md': ['photo.png'] });
    const result = findCandidateSourcePaths('attachments/photo.png', r, u);
    // notes/note.md appears in both — must be deduplicated
    expect(result).toContain('notes/note.md');
    // other/other.md matched via bare name
    expect(result).toContain('other/other.md');
    expect(result.filter((p) => p === 'notes/note.md')).toHaveLength(1);
  });

  it('does NOT include unrelated files that reference other images', () => {
    const r = resolved({ 'notes/unrelated.md': ['attachments/other.png'] });
    const result = findCandidateSourcePaths('attachments/photo.png', r, {});
    expect(result).toEqual([]);
  });

  it('returns empty array when both maps are empty (cache not ready)', () => {
    const result = findCandidateSourcePaths('photo.png', {}, {});
    expect(result).toEqual([]);
  });

  it('returns sorted results for determinism', () => {
    const r = resolved({
      'z-note.md': ['photo.png'],
      'a-note.md': ['photo.png'],
    });
    const result = findCandidateSourcePaths('photo.png', r, {});
    expect(result).toEqual(['a-note.md', 'z-note.md']);
  });

  it('handles multiple sources referencing the same image', () => {
    const r = resolved({
      'notes/a.md': ['attachments/photo.png'],
      'notes/b.md': ['attachments/photo.png'],
      'notes/c.md': ['attachments/other.png'],
    });
    const result = findCandidateSourcePaths('attachments/photo.png', r, {});
    expect(result).toEqual(['notes/a.md', 'notes/b.md']);
  });

  it('wiki-link bare-name match via unresolvedLinks (Markdown and wiki refs)', () => {
    // Wiki links like ![[photo.png]] are stored as bare filename in unresolvedLinks
    // when the file cannot be resolved to a known path.
    const u = unresolved({
      'docs/page.md': ['photo.png'],
      'docs/page2.md': ['subfolder/photo.png'],
    });
    const result = findCandidateSourcePaths('photo.png', {}, u);
    expect(result).toEqual(['docs/page.md', 'docs/page2.md']);
  });
});

// ---------------------------------------------------------------------------
// Metadata cache retry state — createRetryTask / advanceRetryTask
// ---------------------------------------------------------------------------
describe('createRetryTask', () => {
  it('creates task with 0 attempts and correct deadline', () => {
    const now = 1_000_000;
    const task = createRetryTask('photo.png', '/attachments/photo.png', now);
    expect(task.fileName).toBe('photo.png');
    expect(task.newPath).toBe('/attachments/photo.png');
    expect(task.attempts).toBe(0);
    expect(task.deadlineMs).toBe(now + RETRY_DEADLINE_MS);
  });
});

describe('advanceRetryTask', () => {
  const now = 1_000_000;
  const deadline = now + RETRY_DEADLINE_MS;

  it('returns advanced state on first attempt', () => {
    const task = createRetryTask('photo.png', '/path.png', now);
    const next = advanceRetryTask(task, now + 100);
    expect(next).not.toBeNull();
    expect(next!.attempts).toBe(1);
  });

  it('increments attempts on each advance', () => {
    let task = createRetryTask('photo.png', '/path.png', now);
    for (let i = 1; i <= RETRY_MAX_ATTEMPTS - 1; i++) {
      const next = advanceRetryTask(task, now + i * 100);
      expect(next).not.toBeNull();
      task = next!;
      expect(task.attempts).toBe(i);
    }
  });

  it('returns null when attempts reach RETRY_MAX_ATTEMPTS', () => {
    let task = createRetryTask('photo.png', '/path.png', now);
    // Advance to the limit
    for (let i = 0; i < RETRY_MAX_ATTEMPTS; i++) {
      const next = advanceRetryTask(task, now + 100);
      expect(next).not.toBeNull();
      task = next!;
    }
    // One more — should now be null
    const exhausted = advanceRetryTask(task, now + 200);
    expect(exhausted).toBeNull();
  });

  it('returns null when deadline has passed', () => {
    const task = createRetryTask('photo.png', '/path.png', now);
    const afterDeadline = advanceRetryTask(task, deadline + 1);
    expect(afterDeadline).toBeNull();
  });

  it('returns null exactly at deadline (boundary)', () => {
    const task = createRetryTask('photo.png', '/path.png', now);
    const atDeadline = advanceRetryTask(task, deadline);
    expect(atDeadline).toBeNull();
  });

  it('succeeds just before deadline', () => {
    const task = createRetryTask('photo.png', '/path.png', now);
    const justBefore = advanceRetryTask(task, deadline - 1);
    expect(justBefore).not.toBeNull();
  });

  it('dedupe: two tasks for same file are independent state objects', () => {
    const t1 = createRetryTask('a.png', '/p1.png', now);
    const t2 = createRetryTask('a.png', '/p2.png', now);
    advanceRetryTask(t1, now + 100);
    // t1 advancing must not affect t2 (immutable state)
    expect(t2.attempts).toBe(0);
  });

  it('preserves fileName and newPath through advances', () => {
    const task = createRetryTask('my image.png', '/folder/my image.png', now);
    const next = advanceRetryTask(task, now + 1);
    expect(next!.fileName).toBe('my image.png');
    expect(next!.newPath).toBe('/folder/my image.png');
  });
});

// ---------------------------------------------------------------------------
// retryTaskKey — task identity helper
// ---------------------------------------------------------------------------
describe('retryTaskKey', () => {
  it('produces identical keys for identical (fileName, newPath)', () => {
    const k1 = retryTaskKey('img.png', '/A/img.png');
    const k2 = retryTaskKey('img.png', '/A/img.png');
    expect(k1).toBe(k2);
  });

  it('produces DISTINCT keys when newPath differs (same fileName)', () => {
    const k1 = retryTaskKey('img.png', '/A/img.png');
    const k2 = retryTaskKey('img.png', '/B/img.png');
    expect(k1).not.toBe(k2);
  });

  it('produces DISTINCT keys when fileName differs (same newPath)', () => {
    const k1 = retryTaskKey('img.png',  '/A/img.png');
    const k2 = retryTaskKey('img2.png', '/A/img.png');
    expect(k1).not.toBe(k2);
  });

  it('contains NUL separator — key cannot be confused with a plain path', () => {
    const k = retryTaskKey('img.png', '/A/img.png');
    expect(k).toContain('\0');
  });

  it('same-filename different-path tasks live as independent map keys', () => {
    const map = new Map<string, number>();
    map.set(retryTaskKey('img.png', '/A/img.png'), 1);
    map.set(retryTaskKey('img.png', '/B/img.png'), 2);
    expect(map.size).toBe(2);
    expect(map.get(retryTaskKey('img.png', '/A/img.png'))).toBe(1);
    expect(map.get(retryTaskKey('img.png', '/B/img.png'))).toBe(2);
  });

  it('exact-duplicate task produces map size 1 (deduplicated on set)', () => {
    const map = new Map<string, number>();
    map.set(retryTaskKey('img.png', '/A/img.png'), 1);
    map.set(retryTaskKey('img.png', '/A/img.png'), 2); // replaces
    expect(map.size).toBe(1);
    expect(map.get(retryTaskKey('img.png', '/A/img.png'))).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// mergeSettings — settings load/merge behaviour
// ---------------------------------------------------------------------------

interface TestSettings {
  debugEnabled: boolean;
  smartAttachmentFolder: boolean;
  smartFolderNames: string;
}

const TEST_DEFAULTS: TestSettings = {
  debugEnabled: false,
  smartAttachmentFolder: true,   // reflects the real DEFAULT_SETTINGS
  smartFolderNames: 'assets, images',
};

describe('mergeSettings', () => {
  it('new install (null saved data) → all defaults apply, smartAttachmentFolder=true', () => {
    const result = mergeSettings(TEST_DEFAULTS, null);
    expect(result.smartAttachmentFolder).toBe(true);
    expect(result.debugEnabled).toBe(false);
    expect(result.smartFolderNames).toBe('assets, images');
  });

  it('new install (undefined saved data) → all defaults apply', () => {
    const result = mergeSettings(TEST_DEFAULTS, undefined);
    expect(result.smartAttachmentFolder).toBe(true);
  });

  it('existing user with explicit false → preserved (not overridden by default true)', () => {
    const result = mergeSettings(TEST_DEFAULTS, { smartAttachmentFolder: false });
    expect(result.smartAttachmentFolder).toBe(false);
  });

  it('existing user with explicit true → preserved', () => {
    const result = mergeSettings(TEST_DEFAULTS, { smartAttachmentFolder: true });
    expect(result.smartAttachmentFolder).toBe(true);
  });

  it('saved custom smartFolderNames → preserved', () => {
    const result = mergeSettings(TEST_DEFAULTS, { smartFolderNames: 'pics, media' });
    expect(result.smartFolderNames).toBe('pics, media');
    // other fields still come from defaults
    expect(result.smartAttachmentFolder).toBe(true);
  });

  it('saved debugEnabled=true → preserved', () => {
    const result = mergeSettings(TEST_DEFAULTS, { debugEnabled: true });
    expect(result.debugEnabled).toBe(true);
  });

  it('empty object saved data → all defaults apply', () => {
    const result = mergeSettings(TEST_DEFAULTS, {});
    expect(result.smartAttachmentFolder).toBe(true);
    expect(result.debugEnabled).toBe(false);
  });

  it('does not mutate the defaults object', () => {
    const defaults = { ...TEST_DEFAULTS };
    mergeSettings(defaults, { smartAttachmentFolder: false });
    expect(defaults.smartAttachmentFolder).toBe(true);
  });
});
