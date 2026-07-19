import { describe, it, expect } from 'vitest';
import {
  escapeRegExp,
  mimeSubtypeToExtension,
  encodeMarkdownPath,
  ensureLeadingSlash,
  applyLinkReplacements,
  parseSmartFolderNames,
  resolveSmartAttachmentFolder,
} from '../src/utils';

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
