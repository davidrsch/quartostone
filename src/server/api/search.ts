// src/server/api/search.ts
// Full-text search across all .qmd pages.
// Uses a simple in-memory inverted index with TF–IDF-style scoring.
//
// GET  /api/search?q=<query>  → [{ path, title, excerpt, score }]
// POST /api/search/reindex    → rebuilds the full index

import type { Express, Request, Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { ServerContext } from '../index.js';
import { collectQmd } from '../utils/qmdFiles.js';
import { getTitleWithFallback } from '../utils/frontmatter.js';
import type { SearchResult } from '../../shared/types.js';

// Re-export so existing code that imports SearchResult from this module continues to work.
export type { SearchResult };

interface IndexEntry {
  path:    string;
  title:   string;
  body:    string;   // stripped body text
  /** Lowercased tokens for fast lookup */
  tokens:  string[];
}

// ── Index store ───────────────────────────────────────────────────────────────

const index = new Map<string, IndexEntry>();

// ── Text processing ───────────────────────────────────────────────────────────

/** Strip YAML front-matter, markdown syntax, wiki links, and Quarto shortcodes */
function stripMarkdown(raw: string): string {
  // Remove YAML front-matter
  let text = raw.replace(/^---[\s\S]*?---\s*/m, '');
  // Remove code fences
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`[^`]+`/g, ' ');
  // Remove wiki links — keep display text
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');
  // Remove Quarto/Pandoc shortcodes and divs
  text = text.replace(/::: ?\{[^}]*\}[\s\S]*?:::/g, ' ');
  text = text.replace(/\{\{[^}]*\}\}/g, ' ');
  // Remove markdown formatting characters
  text = text.replace(/^#{1,6}\s+/gm, '');       // headings
  text = text.replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1'); // bold/italic
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');  // links
  text = text.replace(/^\s*[-*+>|]\s*/gm, '');   // bullets & blockquotes
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function extractFrontMatterTitle(raw: string, fallback: string): string {
  return getTitleWithFallback(raw, fallback);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_-]{2,}/g) ?? [];
}

// ── Index management ──────────────────────────────────────────────────────────


/** Rebuild the full search index from all .qmd files in pagesDir */
export function rebuildSearchIndex(pagesDir: string): void {
  index.clear();
  const paths = collectQmd(pagesDir, pagesDir);
  for (const relPath of paths) {
    indexFile(pagesDir, relPath);
  }
}

/** Incrementally update the index for a single file */
export function updateSearchIndexForFile(pagesDir: string, relPath: string): void {
  indexFile(pagesDir, relPath);
}

/** Remove a file from the index */
export function removeSearchIndexForFile(relPath: string): void {
  index.delete(relPath);
}

function indexFile(pagesDir: string, relPath: string): void {
  const absPath = join(pagesDir, relPath);
  if (!existsSync(absPath)) { index.delete(relPath); return; }

  let raw: string;
  try { raw = readFileSync(absPath, 'utf-8'); }
  catch { index.delete(relPath); return; }

  const slug = basename(relPath, '.qmd');
  const title = extractFrontMatterTitle(raw, slug);
  const body  = stripMarkdown(raw);

  // Boost title tokens (appear effectively 5× in token list)
  const titleTokens = tokenize(title);
  const bodyTokens  = tokenize(body);
  const tokens = [
    ...titleTokens, ...titleTokens, ...titleTokens, ...titleTokens, ...titleTokens,
    ...bodyTokens,
  ];

  index.set(relPath, { path: relPath, title, body, tokens });
}

// Export for testing
export { index };

/** Reset the index — intended for use in tests only */
export function resetSearchIndex(): void {
  index.clear();
}

// ── Search ────────────────────────────────────────────────────────────────────

/** Extract a short excerpt from body text around the first query-term match */
function makeExcerpt(body: string, queryTerms: string[], maxLen = 160): string {
  if (!body) return '';
  const lower = body.toLowerCase();

  let bestPos = 0;
  for (const term of queryTerms) {
    const pos = lower.indexOf(term);
    if (pos >= 0) { bestPos = pos; break; }
  }

  const start = Math.max(0, bestPos - 40);
  const end   = Math.min(body.length, start + maxLen);
  const raw   = body.slice(start, end);
  return (start > 0 ? '…' : '') + raw + (end < body.length ? '…' : '');
}

/** Score a document against query terms */
function scoreDoc(entry: IndexEntry, queryTerms: string[]): number {
  if (!queryTerms.length) return 0;
  const total = entry.tokens.length;
  if (total === 0) return 0;

  let score = 0;
  for (const term of queryTerms) {
    let tf = 0;
    for (const t of entry.tokens) {
      if (t.includes(term)) tf++;
    }
    // Simple TF: normalise by document length
    score += tf / total;
  }
  return score;
}

export function search(query: string): SearchResult[] {
  if (!query.trim()) return [];

  const queryTerms = tokenize(query);
  if (!queryTerms.length) return [];

  const results: SearchResult[] = [];

  for (const entry of index.values()) {
    const score = scoreDoc(entry, queryTerms);
    if (score <= 0) continue;
    results.push({
      path:    entry.path,
      title:   entry.title,
      excerpt: makeExcerpt(entry.body, queryTerms),
      score,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

// ── Register routes ───────────────────────────────────────────────────────────

export function registerSearchApi(app: Express, ctx: ServerContext): void {
  const pagesDir = join(ctx.cwd, ctx.config.pages_dir);

  // GET /api/search?q=<query>
  app.get('/api/search', (req: Request, res: Response) => {
    const q = (req.query['q'] as string) ?? '';
    if (!q.trim()) return res.json([]);
    res.json(search(q));
  });

  // POST /api/search/reindex — rebuild full index
  app.post('/api/search/reindex', (_req: Request, res: Response) => {
    rebuildSearchIndex(pagesDir);
    res.json({ ok: true, indexed: index.size });
  });
}
