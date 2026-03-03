// src/server/api/links.ts
// Wiki-link index: scans .qmd files for [[wiki link]] syntax and builds an
// in-memory bi-directional link graph.
//
// GET /api/links/backlinks?path=  → pages that link TO this file
// GET /api/links/forward?path=    → pages this file links TO
// GET /api/links/graph            → { nodes, edges } for graph view

import type { Express, Request, Response } from 'express';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import type { ServerContext } from '../index.js';

// ── Wiki link regex ───────────────────────────────────────────────────────────

// Matches [[Target]], [[Target|Display]], [[Target#anchor]], [[Target#anchor|Display]]
const WIKI_LINK_RE = /\[\[([^\]]+?)\]\]/g;

// ── Link index ────────────────────────────────────────────────────────────────

// forwardLinks[relPath] = Set of resolved page paths this file links to
const forwardLinks = new Map<string, Set<string>>();

// allPages[relPath] = { title, tags }
export interface PageMeta {
  path:  string;
  title: string;
  tags:  string[];
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

// ── Front-matter title extractor (no yaml import needed for minimal parsing) ──

function extractTitle(content: string, fallbackSlug: string): string {
  // Look for `title: "..."` or `title: ...` in front-matter
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    const titleMatch = fm[1]?.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) return (titleMatch[1] ?? '').trim();
  }
  return fallbackSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function extractTags(content: string): string[] {
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return [];
  const tagsMatch = fm[1]?.match(/^tags:\s*\[([^\]]*)\]\s*$/m);
  if (tagsMatch) {
    return (tagsMatch[1] ?? '').split(',').map(t => t.replace(/["'\s]/g, '')).filter(Boolean);
  }
  const tagsBlockMatch = fm[1]?.match(/^tags:\s*\n((?:  ?[-*] .+\n?)*)/m);
  if (tagsBlockMatch) {
    return (tagsBlockMatch[1] ?? '').split('\n')
      .map(l => l.replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

// ── Scan a single file ────────────────────────────────────────────────────────

function scanFile(relPath: string, absPath: string, allPagePaths: string[]): void {
  let content: string;
  try { content = readFileSync(absPath, 'utf-8'); }
  catch { forwardLinks.delete(relPath); pageMeta.delete(relPath); return; }

  // Update page meta
  const slug = basename(relPath, '.qmd');
  pageMeta.set(relPath, {
    path:  relPath,
    title: extractTitle(content, slug),
    tags:  extractTags(content),
  });

  // Extract all outgoing wiki links
  const links = new Set<string>();
  let m: RegExpExecArray | null;
  WIKI_LINK_RE.lastIndex = 0;
  while ((m = WIKI_LINK_RE.exec(content)) !== null) {
    const target = m[1] ?? '';
    const slug2  = targetToSlug(target);
    const resolved = resolveSlug(slug2, allPagePaths);
    if (resolved && resolved !== relPath) links.add(resolved);
  }
  forwardLinks.set(relPath, links);
}

// ── Full index rebuild ────────────────────────────────────────────────────────

function collectQmd(dir: string, root: string): string[] {
  let results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(collectQmd(full, root));
      } else if (entry.isFile() && extname(entry.name) === '.qmd') {
        results.push(relative(root, full).replace(/\\/g, '/'));
      }
    }
  } catch { /* ignore */ }
  return results;
}

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

// ── Register routes ───────────────────────────────────────────────────────────

export function registerLinksApi(app: Express, ctx: ServerContext): void {
  const pagesDir = join(ctx.cwd, ctx.config.pages_dir);

  // GET /api/links/backlinks?path=<relPath>
  app.get('/api/links/backlinks', (req: Request, res: Response) => {
    const target = req.query['path'] as string | undefined;
    if (!target) return res.status(400).json({ error: 'path is required' });

    const backlinks: { path: string; title: string; excerpt: string }[] = [];

    for (const [sourcePath, targets] of forwardLinks.entries()) {
      if (!targets.has(target)) continue;
      const meta = pageMeta.get(sourcePath);
      // Extract excerpt containing the wiki link
      let excerpt = '';
      try {
        const content = readFileSync(join(pagesDir, sourcePath), 'utf-8');
        const targetTitle = pageMeta.get(target)?.title ?? target;
        const linkRe = new RegExp(`\\[\\[${targetTitle}[^\\]]*\\]\\]`, 'i');
        const lineIdx = content.split('\n').findIndex(l => linkRe.test(l) || l.includes(`[[`));
        if (lineIdx >= 0) excerpt = (content.split('\n')[lineIdx] ?? '').trim().slice(0, 120);
      } catch { /* ignore */ }
      backlinks.push({ path: sourcePath, title: meta?.title ?? sourcePath, excerpt });
    }

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
