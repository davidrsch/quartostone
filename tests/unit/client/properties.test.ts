// tests/unit/client/properties.test.ts
// Unit tests for pure utility functions in src/client/properties/index.ts.

import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  coerce,
  serializeFrontmatter,
} from '../../../src/client/properties/index.js';

// ── parseFrontmatter ──────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  it('returns empty meta and original content for content without frontmatter', () => {
    const { fm, body } = parseFrontmatter('# Heading\n\nNo frontmatter here.');
    expect(fm).toEqual({});
    expect(body).toBe('# Heading\n\nNo frontmatter here.');
  });

  it('parses basic key-value frontmatter', () => {
    const src = '---\ntitle: My Page\nauthor: Alice\n---\n\nBody text.';
    const { fm, body } = parseFrontmatter(src);
    expect(fm.title).toBe('My Page');
    expect(fm.author).toBe('Alice');
    expect(body).toBe('\n\nBody text.');
  });

  it('parses multi-line list using dash items', () => {
    const src = '---\ncategories:\n  - foo\n  - bar\n  - baz\n---\nContent.';
    const { fm } = parseFrontmatter(src);
    expect(Array.isArray(fm.categories)).toBe(true);
    expect(fm.categories).toEqual(['foo', 'bar', 'baz']);
  });

  it('parses inline list notation', () => {
    const src = '---\ncategories: [alpha, beta]\n---\nContent.';
    const { fm } = parseFrontmatter(src);
    expect(fm.categories).toEqual(['alpha', 'beta']);
  });

  it('handles a title containing a colon by preserving the value', () => {
    // When a value contains ':' yaml wraps it in quotes; our parser strips them
    const src = '---\ntitle: "foo: bar"\n---\n';
    const { fm } = parseFrontmatter(src);
    expect(fm.title).toBe('foo: bar');
  });

  it('parses boolean field draft: true', () => {
    const src = '---\ndraft: true\n---\n';
    const { fm } = parseFrontmatter(src);
    expect(fm.draft).toBe(true);
  });

  it('parses numeric port field', () => {
    const src = '---\nword_count: 42\n---\n';
    const { fm } = parseFrontmatter(src);
    expect(fm['word_count']).toBe(42);
  });
});

// ── coerce ────────────────────────────────────────────────────────────────────

describe('coerce', () => {
  it('converts "true" to boolean true', () => {
    expect(coerce('true')).toBe(true);
  });

  it('converts "false" to boolean false', () => {
    expect(coerce('false')).toBe(false);
  });

  it('converts "42" to number 42', () => {
    expect(coerce('42')).toBe(42);
  });

  it('converts "3.14" to number 3.14', () => {
    expect(coerce('3.14')).toBe(3.14);
  });

  it('leaves a plain word as a string', () => {
    expect(coerce('hello')).toBe('hello');
  });

  it('strips surrounding double quotes from string values', () => {
    expect(coerce('"hello world"')).toBe('hello world');
  });

  it('strips surrounding single quotes from string values', () => {
    expect(coerce("'hello world'")).toBe('hello world');
  });

  it('does not convert empty string to a number', () => {
    // empty string → Number('') === 0, but we guard val !== ''
    expect(coerce('')).toBe('');
  });
});

// ── serializeFrontmatter ──────────────────────────────────────────────────────

describe('serializeFrontmatter', () => {
  it('produces a YAML fence with --- delimiters', () => {
    const out = serializeFrontmatter({ title: 'Hello' });
    expect(out.startsWith('---\n')).toBe(true);
    expect(out.endsWith('\n---')).toBe(true);
  });

  it('round-trips basic metadata', () => {
    const fm = { title: 'My Page', author: 'Alice', draft: false };
    const yaml = serializeFrontmatter(fm);
    // Re-parse to verify round-trip
    const full = yaml + '\n\nBody.';
    const { fm: parsed } = parseFrontmatter(full);
    expect(parsed.title).toBe('My Page');
    expect(parsed.author).toBe('Alice');
    expect(parsed.draft).toBe(false);
  });

  it('preserves title before author before date (key order)', () => {
    const fm = { date: '2024-01-01', author: 'Alice', title: 'Hello' };
    const yaml = serializeFrontmatter(fm);
    const titleIdx = yaml.indexOf('title:');
    const authorIdx = yaml.indexOf('author:');
    const dateIdx = yaml.indexOf('date:');
    expect(titleIdx).toBeLessThan(authorIdx);
    expect(authorIdx).toBeLessThan(dateIdx);
  });

  it('skips fields whose value is undefined, null, or empty string', () => {
    const out = serializeFrontmatter({ title: 'Valid', description: '', author: undefined });
    expect(out).not.toContain('description:');
    expect(out).not.toContain('author:');
    expect(out).toContain('title: Valid');
  });

  it('serialises an array of categories with inline notation', () => {
    const out = serializeFrontmatter({ categories: ['news', 'tech'] });
    expect(out).toContain('categories:');
    expect(out).toContain('news');
    expect(out).toContain('tech');
  });

  it('quotes string values that contain a colon', () => {
    const out = serializeFrontmatter({ title: 'foo: bar' });
    expect(out).toContain('"foo: bar"');
  });
});
