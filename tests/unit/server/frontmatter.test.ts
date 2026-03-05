// tests/unit/server/frontmatter.test.ts
// Unit tests for src/server/utils/frontmatter.ts

import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  getTitle,
  getTitleWithFallback,
  getTags,
  getFrontmatterKey,
} from '../../../src/server/utils/frontmatter.js';

// ── parseFrontmatter ──────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  it('returns empty meta and empty body for empty string', () => {
    const result = parseFrontmatter('');
    expect(result.meta).toEqual({});
    expect(result.body).toBe('');
  });

  it('parses a basic YAML frontmatter block', () => {
    const content = '---\ntitle: Hello\n---\nBody text';
    const result = parseFrontmatter(content);
    expect(result.meta['title']).toBe('Hello');
    expect(result.body).toBe('Body text');
  });

  it('parses multiple YAML fields', () => {
    const content = '---\ntitle: My Page\nauthor: Alice\ndate: 2024-01-01\n---\nContent here.';
    const result = parseFrontmatter(content);
    expect(result.meta['title']).toBe('My Page');
    expect(result.meta['author']).toBe('Alice');
    expect(result.body).toBe('Content here.');
  });

  it('parses YAML array fields', () => {
    const content = '---\ntags:\n  - foo\n  - bar\n---\nBody.';
    const result = parseFrontmatter(content);
    expect(result.meta['tags']).toEqual(['foo', 'bar']);
  });

  it('returns the body text without the frontmatter block', () => {
    const content = '---\ntitle: Title\n---\nFirst line.\nSecond line.\n';
    const result = parseFrontmatter(content);
    expect(result.body).toBe('First line.\nSecond line.\n');
  });

  it('returns empty meta when no frontmatter delimiter is present', () => {
    const content = 'Just plain text with no frontmatter.';
    const result = parseFrontmatter(content);
    expect(result.meta).toEqual({});
    expect(result.body).toBe(content);
  });

  it('does not throw for malformed YAML (unclosed bracket) — falls back to empty meta', () => {
    const content = '---\nbad: [unclosed\n---\nBody';
    expect(() => parseFrontmatter(content)).not.toThrow();
    const result = parseFrontmatter(content);
    expect(result.meta).toEqual({});
  });

  it('returns empty meta and full string when there is no closing --- delimiter', () => {
    const content = '---\ntitle: Unterminated';
    const result = parseFrontmatter(content);
    expect(result.meta).toEqual({});
    expect(result.body).toBe(content);
  });

  it('handles CRLF line endings', () => {
    const content = '---\r\ntitle: CRLF\r\n---\r\nBody text.';
    const result = parseFrontmatter(content);
    expect(result.meta['title']).toBe('CRLF');
    expect(result.body).toBe('Body text.');
  });

  it('handles empty YAML block (blank line between delimiters)', () => {
    // The closing --- requires a preceding newline, so a blank line is needed
    const content = '---\n\n---\nBody only.';
    const result = parseFrontmatter(content);
    expect(result.meta).toEqual({});
    expect(result.body).toBe('Body only.');
  });
});

// ── getTitle ──────────────────────────────────────────────────────────────────

describe('getTitle', () => {
  it('returns the title string from frontmatter', () => {
    const content = '---\ntitle: My Title\n---\nBody.';
    expect(getTitle(content)).toBe('My Title');
  });

  it('returns empty string when no title field is present', () => {
    const content = '---\nauthor: Alice\n---\nBody.';
    expect(getTitle(content)).toBe('');
  });

  it('returns empty string for content with no frontmatter', () => {
    expect(getTitle('Just plain text.')).toBe('');
  });

  it('returns empty string for empty content', () => {
    expect(getTitle('')).toBe('');
  });

  it('returns empty string when title is a non-string YAML value (e.g. number)', () => {
    // YAML parses `title: 42` as a number at runtime; getTitle checks typeof === 'string'
    const content = '---\ntitle: 42\n---\nBody.';
    expect(getTitle(content)).toBe('');
  });
});

// ── getTitleWithFallback ──────────────────────────────────────────────────────

describe('getTitleWithFallback', () => {
  it('returns the frontmatter title when present', () => {
    const content = '---\ntitle: Explicit Title\n---\nBody.';
    expect(getTitleWithFallback(content, 'my-page')).toBe('Explicit Title');
  });

  it('returns a slug-based fallback when no title is present', () => {
    const content = '---\nauthor: Alice\n---\nBody.';
    expect(getTitleWithFallback(content, 'my-page')).toBe('My Page');
  });

  it('capitalises each word of the slug fallback', () => {
    expect(getTitleWithFallback('', 'hello-world-page')).toBe('Hello World Page');
  });

  it('handles single-word slug as fallback', () => {
    expect(getTitleWithFallback('', 'index')).toBe('Index');
  });

  it('returns slug fallback for empty frontmatter block', () => {
    const content = '---\n---\nBody.';
    expect(getTitleWithFallback(content, 'about-us')).toBe('About Us');
  });
});

// ── getTags ───────────────────────────────────────────────────────────────────

describe('getTags', () => {
  it('returns tags from the categories field as an array', () => {
    const content = '---\ncategories:\n  - a\n  - b\n---\nBody.';
    expect(getTags(content)).toEqual(['a', 'b']);
  });

  it('returns tags from the tags field as an array', () => {
    const content = '---\ntags:\n  - x\n  - y\n---\nBody.';
    expect(getTags(content)).toEqual(['x', 'y']);
  });

  it('prefers categories over tags when both are present', () => {
    const content = '---\ncategories:\n  - cat1\ntags:\n  - tag1\n---\nBody.';
    const tags = getTags(content);
    expect(tags).toContain('cat1');
    expect(tags).not.toContain('tag1');
  });

  it('returns empty array when neither tags nor categories is present', () => {
    const content = '---\ntitle: No Tags\n---\nBody.';
    expect(getTags(content)).toEqual([]);
  });

  it('returns empty array when tags value is a scalar (not array)', () => {
    const content = '---\ntags: single-string\n---\nBody.';
    expect(getTags(content)).toEqual([]);
  });

  it('returns empty array for content with no frontmatter', () => {
    expect(getTags('Just text.')).toEqual([]);
  });

  it('filters out non-string array items', () => {
    const content = '---\ntags:\n  - foo\n  - 42\n  - bar\n---\nBody.';
    const tags = getTags(content);
    expect(tags).toContain('foo');
    expect(tags).toContain('bar');
    // The number 42 should be filtered out
    expect(tags.every(t => typeof t === 'string')).toBe(true);
  });
});

// ── getFrontmatterKey ─────────────────────────────────────────────────────────

describe('getFrontmatterKey', () => {
  it('returns the string value for a named scalar key', () => {
    const content = '---\nauthor: Alice\n---\nBody.';
    expect(getFrontmatterKey(content, 'author')).toBe('Alice');
  });

  it('returns undefined when the key is not present', () => {
    const content = '---\ntitle: Page\n---\nBody.';
    expect(getFrontmatterKey(content, 'missing-key')).toBeUndefined();
  });

  it('returns undefined when the key value is not a string (e.g. array)', () => {
    const content = '---\ntags:\n  - a\n  - b\n---\nBody.';
    expect(getFrontmatterKey(content, 'tags')).toBeUndefined();
  });

  it('returns undefined for content with no frontmatter', () => {
    expect(getFrontmatterKey('No frontmatter here.', 'title')).toBeUndefined();
  });

  it('returns the value of custom keys beyond the typed interface', () => {
    const content = '---\ncustom-field: my-value\n---\nBody.';
    expect(getFrontmatterKey(content, 'custom-field')).toBe('my-value');
  });
});
