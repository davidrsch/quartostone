// src/server/utils/frontmatter.ts
// Shared server-side frontmatter parser used across API handlers.
// Uses the 'yaml' package (already a project dependency).

import { parse as yamlParse } from 'yaml';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FrontmatterResult {
  meta: Record<string, unknown>;
  body: string;
}

// ── Core parser ───────────────────────────────────────────────────────────────

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(content: string): FrontmatterResult {
  const m = FM_RE.exec(content);
  if (!m) return { meta: {}, body: content };
  try {
    const meta = (yamlParse(m[1] ?? '') ?? {}) as Record<string, unknown>;
    return { meta, body: content.slice(m[0].length) };
  } catch {
    return { meta: {}, body: content };
  }
}

// ── Convenience accessors ─────────────────────────────────────────────────────

/**
 * Returns the `title` string from frontmatter, or an empty string if absent.
 */
export function getTitle(content: string): string {
  const { meta } = parseFrontmatter(content);
  return typeof meta['title'] === 'string' ? meta['title'] : '';
}

/**
 * Returns the `title` string from frontmatter, or a capitalised fallback
 * derived from `fallbackSlug` when no title is present.
 */
export function getTitleWithFallback(content: string, fallbackSlug: string): string {
  const title = getTitle(content);
  if (title) return title;
  return fallbackSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Returns the tags array from frontmatter `tags` or `categories` field.
 * Handles YAML arrays and inline list syntax.
 */
export function getTags(content: string): string[] {
  const { meta } = parseFrontmatter(content);
  const t = meta['categories'] ?? meta['tags'];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

/**
 * Returns the raw value of a named frontmatter scalar key, or undefined.
 */
export function getFrontmatterKey(content: string, key: string): string | undefined {
  const { meta } = parseFrontmatter(content);
  const v = meta[key];
  return typeof v === 'string' ? v : undefined;
}
