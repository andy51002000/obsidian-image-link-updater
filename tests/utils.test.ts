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
