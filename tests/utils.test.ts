import { describe, it, expect } from 'vitest';
import {
  escapeRegExp,
  mimeSubtypeToExtension,
  encodeMarkdownPath,
  ensureLeadingSlash,
  applyLinkReplacements,
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
