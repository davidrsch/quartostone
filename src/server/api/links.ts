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
import type { ServerContext } from '../context.js';
import { badRequest } from '../utils/errorResponse.js';
import { collectQmd } from '../utils/qmdFiles.js';
import { getTitleWithFallback, getTags } from '../utils/frontmatter.js';
import { WIKI_LINK_SCAN_RE } from '../../shared/wikiLink.js';

// ── Link index ────────────────────────────────────────────────────────────────

// allPages[relPath] = { title, tags, excerpt }
export interface PageMeta {
  path:    string;
  title:   string;
  tags:    string[];
  /** First non-empty body line, stored at index time for backlinks. */
  excerpt: string;
}

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

// ── LinkIndex class ───────────────────────────────────────────────────────────

/** Encapsulates the wiki-link forward index and page metadata. */
export class LinkIndex {
  /** forwardLinks[relPath] = Set of resolved page paths this file links to */
  readonly forwardLinks = new Map<string, Set<string>>();
  readonly pageMeta     = new Map<string, PageMeta>();

  /**
   * O(1) exact stem lookup: basename(relPath, '.qmd').toLowerCase() → relPath.
   * Built during rebuild() / updated incrementally in updateForFile().
   */
  private readonly _stemMap = new Map<string, string>();
  /** Cached list of all .qmd relative paths; avoids repeated full-tree scans (P05). */
  private _cachedPaths: string[] | null = null;

  private _buildStemMap(allPaths: string[]): void {
    this._stemMap.clear();
    for (const p of allPaths) {
      const stem = basename(p, '.qmd').toLowerCase();
      if (!this._stemMap.has(stem)) this._stemMap.set(stem, p);
    }
  }

  /** Resolves a slug to a relPath using the pre-built index (P02). */
  private _resolveSlug(slug: string, allPaths: string[]): string | null {
    // O(1) exact stem match
    const exact = this._stemMap.get(slug);
    if (exact) return exact;
    // O(n) suffix match for path-qualified slugs like "subfolder/my-page"
    for (const p of allPaths) {
      const rel = p.endsWith('.qmd') ? p.slice(0, -4) : p;
      if (rel.endsWith('/' + slug)) return p;
    }
    return null;
  }

  private scanFile(relPath: string, absPath: string, allPagePaths: string[]): void {
    let content: string;
    try { content = readFileSync(absPath, 'utf-8'); }
    catch { this.forwardLinks.delete(relPath); this.pageMeta.delete(relPath); return; }

    const slug = basename(relPath, '.qmd');
    const bodyText = content.replace(/^---[\s\S]*?---\s*/m, '');
    const excerptLine = bodyText.split('\n').map(l => l.trim()).find(l => l.length > 2 && !l.startsWith('#')) ?? '';
    this.pageMeta.set(relPath, {
      path:    relPath,
      title:   getTitleWithFallback(content, slug),
      tags:    getTags(content),
      excerpt: excerptLine.slice(0, 120),
    });

    const links = new Set<string>();
    let m: RegExpExecArray | null;
    WIKI_LINK_SCAN_RE.lastIndex = 0;
    while ((m = WIKI_LINK_SCAN_RE.exec(content)) !== null) {
      const target = m[1] ?? '';
      const slug2  = targetToSlug(target);
      const resolved = this._resolveSlug(slug2, allPagePaths);
      if (resolved && resolved !== relPath) links.add(resolved);
    }
    this.forwardLinks.set(relPath, links);
  }

  rebuild(pagesDir: string): void {
    const allPaths = collectQmd(pagesDir, pagesDir);
    this._cachedPaths = allPaths;
    this.pageMeta.clear();
    this.forwardLinks.clear();
    this._buildStemMap(allPaths);
    for (const relPath of allPaths) {
      this.scanFile(relPath, join(pagesDir, relPath), allPaths);
    }
  }

  updateForFile(pagesDir: string, relPath: string): void {
    // Rescan when the cache is uninitialised or when the target file is not
    // yet in it (e.g. first save after app start with an empty pages dir).
    // This picks up all new files written since the last rebuild/scan so that
    // the stem map used for [[wiki link]] resolution is complete.
    if (this._cachedPaths === null || !this._cachedPaths.includes(relPath)) {
      this._cachedPaths = collectQmd(pagesDir, pagesDir);
      this._buildStemMap(this._cachedPaths);
    }
    const allPaths = this._cachedPaths;
    if (!allPaths.includes(relPath)) {
      this._cachedPaths = [...allPaths, relPath];
      const stem = basename(relPath, '.qmd').toLowerCase();
      if (!this._stemMap.has(stem)) this._stemMap.set(stem, relPath);
    }
    this.scanFile(relPath, join(pagesDir, relPath), this._cachedPaths);
  }

  removeForFile(relPath: string): void {
    this.forwardLinks.delete(relPath);
    this.pageMeta.delete(relPath);
    if (this._cachedPaths) {
      this._cachedPaths = this._cachedPaths.filter(p => p !== relPath);
      const stem = basename(relPath, '.qmd').toLowerCase();
      if (this._stemMap.get(stem) === relPath) this._stemMap.delete(stem);
    }
  }

  reset(): void {
    this.forwardLinks.clear();
    this.pageMeta.clear();
    this._stemMap.clear();
    this._cachedPaths = null;
  }
}

/** Factory — creates a fresh, isolated LinkIndex instance. */
export function createLinkIndex(): LinkIndex { return new LinkIndex(); }

// Module-level singleton used by the server and the backward-compat helpers below.
const _defaultLinkIndex = createLinkIndex();

// ── Backward-compat exports ───────────────────────────────────────────────────
// Tests (and other callers) import these Maps directly and call .clear() on them.
// They remain valid references to the singleton's Maps.

export const forwardLinks = _defaultLinkIndex.forwardLinks;
export const pageMeta     = _defaultLinkIndex.pageMeta;

export function rebuildLinkIndex(pagesDir: string): void {
  _defaultLinkIndex.rebuild(pagesDir);
}

/** Call after a file is saved/created */
export function updateLinkIndexForFile(pagesDir: string, relPath: string): void {
  _defaultLinkIndex.updateForFile(pagesDir, relPath);
}

/** Call after a file is deleted */
export function removeLinkIndexForFile(relPath: string): void {
  _defaultLinkIndex.removeForFile(relPath);
}

/** Reset the index — intended for use in tests only */
export function resetLinkIndex(): void {
  _defaultLinkIndex.reset();
}

// ── Register routes ───────────────────────────────────────────────────────────

export function registerLinksApi(app: Express, ctx: ServerContext): void {
  // Use injected instance from context if provided (enables test isolation),
  // otherwise fall back to the module-level singleton.
  const li = ctx.linkIndex ?? _defaultLinkIndex;

  // GET /api/links/backlinks?path=<relPath>
  app.get('/api/links/backlinks', (req: Request, res: Response) => {
    const target = typeof req.query['path'] === 'string' ? req.query['path'] : undefined;
    if (!target) return badRequest(res, 'path is required');

    // Gather all source files that link to this target and return cached data
    const backlinks = Array.from(li.forwardLinks.entries())
      .filter(([, targets]) => targets.has(target))
      .map(([sourcePath]) => {
        const meta = li.pageMeta.get(sourcePath);
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
    const source = typeof req.query['path'] === 'string' ? req.query['path'] : undefined;
    if (!source) return badRequest(res, 'path is required');

    const targets = li.forwardLinks.get(source) ?? new Set<string>();
    const result = Array.from(targets).map(p => ({
      path:  p,
      title: li.pageMeta.get(p)?.title ?? p,
    }));
    res.json(result);
  });

  // GET /api/links/graph
  app.get('/api/links/graph', (req: Request, res: Response) => {
    // Cap response to prevent huge payloads on large projects (P04)
    const rawLimit = parseInt(String(req.query['limit'] ?? ''), 10);
    const limit = isNaN(rawLimit) || rawLimit <= 0 ? 500 : Math.min(rawLimit, 5000);

    // Compute in-degree for each node
    const inDegree = new Map<string, number>();
    for (const meta of li.pageMeta.values()) inDegree.set(meta.path, 0);
    const edges: { from: string; to: string }[] = [];

    for (const [source, targets] of li.forwardLinks.entries()) {
      for (const target of targets) {
        edges.push({ from: source, to: target });
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      }
    }

    const allNodes = Array.from(li.pageMeta.values()).map(m => ({
      id:       m.path,
      title:    m.title,
      tags:     m.tags,
      inDegree: inDegree.get(m.path) ?? 0,
    }));

    // Return most-connected nodes first; include all edges between visible nodes
    const nodes = allNodes.sort((a, b) => b.inDegree - a.inDegree).slice(0, limit);
    const visibleIds = new Set(nodes.map(n => n.id));
    const filteredEdges = edges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));

    res.json({ nodes, edges: filteredEdges, total: allNodes.length });
  });

  // GET /api/links/search?q=<query>  — autocomplete page titles for [[ popup
  app.get('/api/links/search', (req: Request, res: Response) => {
    const q = ((typeof req.query['q'] === 'string' ? req.query['q'] : '') ?? '').toLowerCase().trim();
    const results = Array.from(li.pageMeta.values())
      .filter(m => !q || m.title.toLowerCase().includes(q) || m.path.toLowerCase().includes(q))
      .slice(0, 20)
      .map(m => ({ path: m.path, title: m.title }));
    res.json(results);
  });
}
