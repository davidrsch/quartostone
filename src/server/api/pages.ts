// src/server/api/pages.ts
// GET    /api/pages          — page tree
// GET    /api/pages/:path    — read .qmd content
// PUT    /api/pages/:path    — write .qmd content
// POST   /api/pages          — create new page
// DELETE /api/pages/:path    — delete a page

import type { Express, Request, Response } from 'express';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, relative, extname, dirname, resolve, sep } from 'node:path';
import type { ServerContext } from '../index.js';
import { updateLinkIndexForFile, removeLinkIndexForFile } from './links.js';
import { updateSearchIndexForFile, removeSearchIndexForFile } from './search.js';

interface PageNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: PageNode[];
}

function buildTree(dir: string, rootDir: string): PageNode[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const nodes: PageNode[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(rootDir, full);
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: rel, type: 'folder', children: buildTree(full, rootDir) });
    } else if (entry.isFile() && extname(entry.name) === '.qmd') {
      nodes.push({ name: entry.name.replace(/\.qmd$/, ''), path: rel, type: 'file' });
    }
  }
  return nodes;
}

export function registerPagesApi(app: Express, ctx: ServerContext) {
  const pagesDir = join(ctx.cwd, ctx.config.pages_dir);

  /** Returns the resolved absolute path, or null after sending 400. */
  function guardPath(rawSuffix: string, res: Response): string | null {
    const pagesDirResolved = resolve(pagesDir);
    const pagePath = join(pagesDir, rawSuffix);
    const filePath = pagePath.endsWith('.qmd') ? pagePath : `${pagePath}.qmd`;
    const abs = resolve(filePath);
    if (!abs.startsWith(pagesDirResolved + sep) && abs !== pagesDirResolved) {
      res.status(400).json({ error: 'Path traversal not allowed' });
      return null;
    }
    return abs;
  }

  app.get('/api/pages', (_req: Request, res: Response) => {
    try {
      const tree = buildTree(pagesDir, pagesDir);
      res.json(tree);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/pages/*', (req: Request, res: Response) => {
    const filePath = guardPath(req.params[0] as string, res);
    if (!filePath) return;
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Page not found' });
    res.json({ path: req.params[0], content: readFileSync(filePath, 'utf-8') });
  });

  app.put('/api/pages/*', (req: Request, res: Response) => {
    const filePath = guardPath(req.params[0] as string, res);
    if (!filePath) return;
    const { content } = req.body as { content: string };
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    // Keep link and search indexes in sync
    const relPath = relative(pagesDir, filePath).replace(/\\/g, '/');
    updateLinkIndexForFile(pagesDir, relPath);
    updateSearchIndexForFile(pagesDir, relPath);
    res.json({ ok: true });
  });

  app.post('/api/pages', (req: Request, res: Response) => {
    const { path: newPath, title } = req.body as { path: string; title?: string };
    if (!newPath) return res.status(400).json({ error: 'path required' });
    const filePath = join(pagesDir, newPath.endsWith('.qmd') ? newPath : `${newPath}.qmd`);
    if (existsSync(filePath)) return res.status(409).json({ error: 'Page already exists' });
    const pageTitle = title ?? newPath.split('/').pop()?.replace('.qmd', '') ?? 'New Page';
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `---\ntitle: "${pageTitle}"\ndate: today\n---\n\n# ${pageTitle}\n`, 'utf-8');
    const newRel = (newPath.endsWith('.qmd') ? newPath : newPath + '.qmd');
    updateLinkIndexForFile(pagesDir, newRel);
    updateSearchIndexForFile(pagesDir, newRel);
    res.status(201).json({ ok: true, path: newPath });
  });

  app.delete('/api/pages/*', (req: Request, res: Response) => {
    const filePath = guardPath(req.params[0] as string, res);
    if (!filePath) return;
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Page not found' });
    rmSync(filePath);
    const relPath = ((req.params[0] as string).endsWith('.qmd')
      ? req.params[0] as string
      : (req.params[0] as string) + '.qmd');
    removeLinkIndexForFile(relPath);
    removeSearchIndexForFile(relPath);
    res.json({ ok: true });
  });
}
