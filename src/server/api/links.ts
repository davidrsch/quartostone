// src/server/api/links.ts
// Wiki-link index: scans .qmd files for [[wiki link]] syntax and builds an
// in-memory bi-directional link graph.
//
// GET /api/links/backlinks?path=  → pages that link TO this file
// GET /api/links/forward?path=    → pages this file links TO
// GET /api/links/graph            → { nodes, edges } for graph view

import type { Express, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { ServerContext } from '../index.js';
import { collectQmd } from '../utils/qmdFiles.js';
import { getTitleWithFallback, getTags } from '../utils/frontmatter.js';
import { WIKI_LINK_SCAN_RE } from '../../shared/wikiLink.js';

// ── Link index ────────────────────────────────────────────────────────────────

// forwardLinks[relPath] = Set of resolved page paths this file links to
const forwardLinks = new Map<string, Set<string>>();

// allPages[relPath] = { title, tags, excerpt }
export interface PageMeta {
  path:    string;
  title:   string;
  tags:    string[];
  /** First non-empty body line, stored at index time for backlinks. */
  excerpt: string;
}

const pageMeta = new Map<string, PageMeta>();

// ── Slug conversion ───────────────────────────────────────────────────────────

/** Convert wiki link target text to a slug that matches a .qmd filename */
function targetToSlug(target: string): string {
  // Strip anchor and display parts: "My Page#heading" → "My Page"
  const base = target.split('#')[0]?.split('|')[0]?.trim() ?? target;
  return base.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_/]/g, '');
}

/** Given a slug, find the matching relative .qmd path in the pages dir */
function resolveSlug(slug: string, allPaths: string[]): string | null {
  // First exact match: "my-page" → "my-page.qmd" or "subdir/my-page.qmd"
  for (const p of allPaths) {
    const stem = basename(p, '.qmd');
    if (stem === slug) return p;
  }
  // Partial suffix match
  for (const p of allPaths) {
    const stem = basename(p, '.qmd');
    if (stem.endsWith('/' + slug)) return p;
  }
  return null;
}

// ── Front-matter helpers (delegated to shared utilities) ─────────────────────────────────────────

const extractTitle = getTitleWithFallback;
const extractTags  = getTags;

// ── Scan a single file ────────────────────────────────────────────────────────

function scanFile(relPath: string, absPath: string, allPagePaths: string[]): void {
  let content: string;
  try { content = readFileSync(absPath, 'utf-8'); }
  catch { forwardLinks.delete(relPath); pageMeta.delete(relPath); return; }

  // Update page meta — extract a short excerpt from the body for backlinks
  const slug = basename(relPath, '.qmd');
  const bodyText = content.replace(/^---[\s\S]*?---\s*/m, '');
  const excerptLine = bodyText.split('\n').map(l => l.trim()).find(l => l.length > 2 && !l.startsWith('#')) ?? '';
  pageMeta.set(relPath, {
    path:    relPath,
    title:   extractTitle(content, slug),
    tags:    extractTags(content),
    excerpt: excerptLine.slice(0, 120),
  });

  // Extract all outgoing wiki links
  const links = new Set<string>();
  let m: RegExpExecArray | null;
  WIKI_LINK_SCAN_RE.lastIndex = 0;
  while ((m = WIKI_LINK_SCAN_RE.exec(content)) !== null) {
    const target = m[1] ?? '';
    const slug2  = targetToSlug(target);
    const resolved = resolveSlug(slug2, allPagePaths);
    if (resolved && resolved !== relPath) links.add(resolved);
  }
  forwardLinks.set(relPath, links);
}

// ── Full index rebuild ────────────────────────────────────────────────────────

export function rebuildLinkIndex(pagesDir: string): void {
  const allPaths = collectQmd(pagesDir, pagesDir);
  pageMeta.clear();
  forwardLinks.clear();
  for (const relPath of allPaths) {
    scanFile(relPath, join(pagesDir, relPath), allPaths);
  }
}

/** Call after a file is saved/created */
export function updateLinkIndexForFile(pagesDir: string, relPath: string): void {
  const allPaths = collectQmd(pagesDir, pagesDir);
  // Ensure this file is in the allPaths list even if brand-new
  if (!allPaths.includes(relPath)) allPaths.push(relPath);
  scanFile(relPath, join(pagesDir, relPath), allPaths);
}

/** Call after a file is deleted */
export function removeLinkIndexForFile(relPath: string): void {
  forwardLinks.delete(relPath);
  pageMeta.delete(relPath);
}

// ── Exports for testing ───────────────────────────────────────────────────────

export { forwardLinks, pageMeta };

/** Reset the index — intended for use in tests only */
export function resetLinkIndex(): void {
  forwardLinks.clear();
  pageMeta.clear();
}

// ── Register routes ───────────────────────────────────────────────────────────

export function registerLinksApi(app: Express, _ctx: ServerContext): void {
  // GET /api/links/backlinks?path=<relPath>
  app.get('/api/links/backlinks', (req: Request, res: Response) => {
    const target = req.query['path'] as string | undefined;
    if (!target) return res.status(400).json({ error: 'path is required' });

    // Gather all source files that link to this target and return cached data
    const backlinks = Array.from(forwardLinks.entries())
      .filter(([, targets]) => targets.has(target))
      .map(([sourcePath]) => {
        const meta = pageMeta.get(sourcePath);
        return {
          path:    sourcePath,
          title:   meta?.title   ?? sourcePath,
          excerpt: meta?.excerpt ?? '',
        };
      });

    res.json(backlinks);
  });

  // GET /api/links/forward?path=<relPath>
  app.get('/api/links/forward', (req: Request, res: Response) => {
    const source = req.query['path'] as string | undefined;
    if (!source) return res.status(400).json({ error: 'path is required' });

    const targets = forwardLinks.get(source) ?? new Set<string>();
    const result = Array.from(targets).map(p => ({
      path:  p,
      title: pageMeta.get(p)?.title ?? p,
    }));
    res.json(result);
  });

  // GET /api/links/graph
  app.get('/api/links/graph', (_req: Request, res: Response) => {
    // Compute in-degree for each node
    const inDegree = new Map<string, number>();
    for (const meta of pageMeta.values()) inDegree.set(meta.path, 0);
    const edges: { from: string; to: string }[] = [];

    for (const [source, targets] of forwardLinks.entries()) {
      for (const target of targets) {
        edges.push({ from: source, to: target });
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      }
    }

    const nodes = Array.from(pageMeta.values()).map(m => ({
      id:       m.path,
      title:    m.title,
      tags:     m.tags,
      inDegree: inDegree.get(m.path) ?? 0,
    }));

    res.json({ nodes, edges });
  });

  // GET /api/links/search?q=<query>  — autocomplete page titles for [[ popup
  app.get('/api/links/search', (req: Request, res: Response) => {
    const q = ((req.query['q'] as string) ?? '').toLowerCase().trim();
    const results = Array.from(pageMeta.values())
      .filter(m => !q || m.title.toLowerCase().includes(q) || m.path.toLowerCase().includes(q))
      .slice(0, 20)
      .map(m => ({ path: m.path, title: m.title }));
    res.json(results);
  });
}
