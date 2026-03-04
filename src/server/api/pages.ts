// src/server/api/pages.ts
// GET    /api/pages          — page tree
// GET    /api/pages/:path    — read .qmd content
// PUT    /api/pages/:path    — write .qmd content
// POST   /api/pages          — create new page
// DELETE /api/pages/:path    — delete a page

import type { Express, Request, Response } from 'express';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join, relative, extname, dirname, resolve, sep } from 'node:path';
import type { ServerContext } from '../index.js';
import { updateLinkIndexForFile, removeLinkIndexForFile } from './links.js';
import { updateSearchIndexForFile, removeSearchIndexForFile } from './search.js';

interface PageNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  icon?: string;
  children?: PageNode[];
}

/** Extract a single YAML scalar from a QMD frontmatter string without a full YAML parse. */
function extractFrontmatterKey(content: string, key: string): string | undefined {
  // Match only inside the leading `---` block
  const fmMatch = /^---\r?\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) return undefined;
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const m = re.exec(fmMatch[1]);
  if (!m) return undefined;
  // Strip surrounding quotes if present
  return m[1].replace(/^['"]|['"]$/g, '').trim();
}

function buildTree(dir: string, rootDir: string): PageNode[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const nodes: PageNode[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(rootDir, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: rel, type: 'folder', children: buildTree(full, rootDir) });
    } else if (entry.isFile() && extname(entry.name) === '.qmd') {
      let icon: string | undefined;
      try {
        const content = readFileSync(full, 'utf-8');
        icon = extractFrontmatterKey(content, 'icon');
      } catch { /* ignore */ }
      const node: PageNode = { name: entry.name.replace(/\.qmd$/, ''), path: rel, type: 'file' };
      if (icon) node.icon = icon;
      nodes.push(node);
    }
  }
  return nodes;
}

export function registerPagesApi(app: Express, ctx: ServerContext) {
  const pagesDir = join(ctx.cwd, ctx.config.pages_dir);

  /** Returns the resolved absolute path for a .qmd file, or null after sending 400. */
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

  /** Returns the resolved absolute path for any path within pagesDir, or null after sending 400. */
  function guardAnyPath(rawSuffix: string, res: Response): string | null {
    const pagesDirResolved = resolve(pagesDir);
    const abs = resolve(join(pagesDir, rawSuffix));
    if (!abs.startsWith(pagesDirResolved + sep)) {
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

  app.patch('/api/pages/*', (req: Request, res: Response) => {
    const rawOld = req.params[0] as string;
    const { newPath } = req.body as { newPath?: string };
    if (!newPath) return res.status(400).json({ error: 'newPath required' });

    const pagesDirResolved = resolve(pagesDir);
    // Detect whether the target is a .qmd file or a directory
    const asFile = resolve(join(pagesDir, rawOld.endsWith('.qmd') ? rawOld : `${rawOld}.qmd`));
    const asDir  = resolve(join(pagesDir, rawOld));

    let oldAbs: string;
    let isFile: boolean;

    if (asFile.startsWith(pagesDirResolved + sep) && existsSync(asFile)) {
      oldAbs = asFile; isFile = true;
    } else if (asDir.startsWith(pagesDirResolved + sep) && existsSync(asDir)) {
      oldAbs = asDir; isFile = false;
    } else {
      return res.status(404).json({ error: 'Not found' });
    }

    const newAbsRaw = isFile
      ? resolve(join(pagesDir, newPath.endsWith('.qmd') ? newPath : `${newPath}.qmd`))
      : resolve(join(pagesDir, newPath));

    if (!newAbsRaw.startsWith(pagesDirResolved + sep)) {
      return res.status(400).json({ error: 'Path traversal not allowed' });
    }
    if (existsSync(newAbsRaw)) return res.status(409).json({ error: 'Target path already exists' });

    mkdirSync(dirname(newAbsRaw), { recursive: true });
    renameSync(oldAbs, newAbsRaw);

    if (isFile) {
      const oldRel = relative(pagesDir, oldAbs).replace(/\\/g, '/');
      const newRel = relative(pagesDir, newAbsRaw).replace(/\\/g, '/');
      removeLinkIndexForFile(oldRel);
      removeSearchIndexForFile(oldRel);
      updateLinkIndexForFile(pagesDir, newRel);
      updateSearchIndexForFile(pagesDir, newRel);
    }
    res.json({ ok: true });
  });

  app.post('/api/pages', (req: Request, res: Response) => {
    const { path: newPath, title } = req.body as { path: string; title?: string };
    if (!newPath) return res.status(400).json({ error: 'path required' });
    const normalized = newPath.endsWith('.qmd') ? newPath : `${newPath}.qmd`;
    const filePath = guardAnyPath(normalized, res);
    if (!filePath) return;
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

    // Soft-delete: move file to .quartostone/trash/ instead of permanent removal
    const trashDir = join(ctx.cwd, '.quartostone', 'trash');
    mkdirSync(trashDir, { recursive: true });
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const relPath = relative(pagesDir, filePath).replace(/\\/g, '/');
    writeFileSync(
      join(trashDir, `${id}.meta.json`),
      JSON.stringify({ id, originalPath: relPath, name: relPath.replace(/\.qmd$/, ''), deletedAt: new Date().toISOString() }),
      'utf-8',
    );
    renameSync(filePath, join(trashDir, `${id}.qmd`));
    removeLinkIndexForFile(relPath);
    removeSearchIndexForFile(relPath);
    res.json({ ok: true, trashed: id });
  });

  // ── Directory management ─────────────────────────────────────────────────
  app.post('/api/directories', (req: Request, res: Response) => {
    const { path: folderPath } = req.body as { path?: string };
    if (!folderPath) return res.status(400).json({ error: 'path required' });
    const abs = guardAnyPath(folderPath, res);
    if (!abs) return;
    if (existsSync(abs)) return res.status(409).json({ error: 'Directory already exists' });
    mkdirSync(abs, { recursive: true });
    res.status(201).json({ ok: true, path: folderPath });
  });

  app.delete('/api/directories/*', (req: Request, res: Response) => {
    const abs = guardAnyPath(req.params[0] as string, res);
    if (!abs) return;
    if (!existsSync(abs)) return res.status(404).json({ error: 'Not found' });
    let entries: string[];
    try { entries = readdirSync(abs); } catch { return res.status(400).json({ error: 'Not a directory' }); }
    if (entries.length > 0) return res.status(409).json({ error: 'Directory not empty' });
    rmSync(abs, { recursive: true });
    res.json({ ok: true });
  });
}
