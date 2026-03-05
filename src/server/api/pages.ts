// src/server/api/pages.ts
// GET    /api/pages          — page tree
// GET    /api/pages/:path    — read .qmd content
// PUT    /api/pages/:path    — write .qmd content
// POST   /api/pages          — create new page
// DELETE /api/pages/:path    — delete a page

import type { Express, Request, Response } from 'express';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmdirSync, renameSync, openSync, writeSync, closeSync, realpathSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ServerContext } from '../index.js';
import { badRequest, notFound, conflict, serverError } from '../utils/errorResponse.js';
import { updateLinkIndexForFile, removeLinkIndexForFile } from './links.js';
import { updateSearchIndexForFile, removeSearchIndexForFile } from './search.js';
import { resolveInsideDir, PathTraversalError, isInsideDir } from '../utils/pathGuard.js';
import { getFrontmatterKey } from '../utils/frontmatter.js';
import type { PageNode } from '../../shared/types.js';

function buildTree(dir: string, rootDir: string, depth = 0): PageNode[] {
  if (depth > 20) return [];  // prevent infinite recursion / symlink cycles
  const entries = readdirSync(dir, { withFileTypes: true });
  const nodes: PageNode[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(rootDir, full).replace(/\\/g, '/');
    // S19: Guard against symlinks pointing outside the pages directory
    if (entry.isSymbolicLink()) {
      try {
        const real = realpathSync(full);
        if (!isInsideDir(rootDir, real)) continue;
      } catch {
        continue; // broken symlink
      }
    }
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: rel, type: 'folder', children: buildTree(full, rootDir, depth + 1) });
    } else if (entry.isFile() && extname(entry.name) === '.qmd') {
      let icon: string | undefined;
      try {
        const content = readFileSync(full, 'utf-8');
        icon = getFrontmatterKey(content, 'icon');
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
    const withQmd = rawSuffix.endsWith('.qmd') ? rawSuffix : `${rawSuffix}.qmd`;
    try {
      return resolveInsideDir(pagesDir, withQmd);
    } catch (e) {
      if (e instanceof PathTraversalError) {
        badRequest(res, 'Path traversal not allowed');
        return null;
      }
      throw e;
    }
  }

  /** Returns the resolved absolute path for any path within pagesDir, or null after sending 400. */
  function guardAnyPath(rawSuffix: string, res: Response): string | null {
    try {
      return resolveInsideDir(pagesDir, rawSuffix);
    } catch (e) {
      if (e instanceof PathTraversalError) {
        badRequest(res, 'Path traversal not allowed');
        return null;
      }
      throw e;
    }
  }

  app.get('/api/pages', (_req: Request, res: Response) => {
    try {
      const tree = buildTree(pagesDir, pagesDir);
      res.json(tree);
    } catch (e) {
      serverError(res, String(e));
    }
  });

  app.get('/api/pages/*', (req: Request, res: Response) => {
    const filePath = guardPath(req.params[0] as string, res);
    if (!filePath) return;
    if (!existsSync(filePath)) return notFound(res, 'Page not found');
    try {
      const content = readFileSync(filePath, 'utf-8');
      const relPath = relative(pagesDir, filePath).replace(/\\/g, '/').replace(/\.qmd$/, '');
      return res.json({ content, path: relPath });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return notFound(res, 'File not found');
      return serverError(res, 'File system error');
    }
  });

  app.put('/api/pages/*', (req: Request, res: Response) => {
    const filePath = guardPath(req.params[0] as string, res);
    if (!filePath) return;
    const { content } = req.body as { content: string };
    if (typeof content !== 'string') return badRequest(res, 'content required');
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
      // Keep link and search indexes in sync
      const relPath = relative(pagesDir, filePath).replace(/\\/g, '/');
      updateLinkIndexForFile(pagesDir, relPath);
      updateSearchIndexForFile(pagesDir, relPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOSPC') return serverError(res, 'No space left on device');
      if (code === 'EACCES') return serverError(res, 'Permission denied');
      return serverError(res, 'File system error');
    }
    res.json({ ok: true });
  });

  app.patch('/api/pages/*', (req: Request, res: Response) => {
    const rawOld = req.params[0] as string;
    const { newPath } = req.body as { newPath?: string };
    if (!newPath) return badRequest(res, 'newPath required');

    // Detect whether the target is a .qmd file or a directory
    let oldAbs: string;
    let isFile: boolean;
    try {
      const asFile = resolveInsideDir(pagesDir, rawOld.endsWith('.qmd') ? rawOld : `${rawOld}.qmd`);
      if (existsSync(asFile)) {
        oldAbs = asFile; isFile = true;
      } else {
        const asDir = resolveInsideDir(pagesDir, rawOld);
        if (existsSync(asDir)) {
          oldAbs = asDir; isFile = false;
        } else {
          return notFound(res, 'Not found');
        }
      }
    } catch {
      return notFound(res, 'Not found');
    }

    let newAbsRaw: string;
    try {
      newAbsRaw = resolveInsideDir(
        pagesDir,
        isFile ? (newPath.endsWith('.qmd') ? newPath : `${newPath}.qmd`) : newPath,
      );
    } catch {
      return badRequest(res, 'Path traversal not allowed');
    }
    if (existsSync(newAbsRaw)) return conflict(res, 'Target path already exists');

    try {
      mkdirSync(dirname(newAbsRaw), { recursive: true });
      renameSync(oldAbs, newAbsRaw);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return conflict(res, 'Name already exists');
      return serverError(res, 'File system error');
    }

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
    if (!newPath) return badRequest(res, 'path required');
    const normalized = newPath.endsWith('.qmd') ? newPath : `${newPath}.qmd`;
    const filePath = guardAnyPath(normalized, res);
    if (!filePath) return;
    const pageTitle = title ?? newPath.split('/').pop()?.replace('.qmd', '') ?? 'New Page';
    const content = `---\ntitle: ${JSON.stringify(pageTitle)}\ndate: today\n---\n\n# ${pageTitle}\n`;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      const fd = openSync(filePath, 'wx');
      writeSync(fd, content);
      closeSync(fd);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return conflict(res, 'Page already exists');
      if (code === 'ENOSPC') return serverError(res, 'No space left on device');
      if (code === 'EACCES') return serverError(res, 'Permission denied');
      return serverError(res, 'File system error');
    }
    const newRel = (newPath.endsWith('.qmd') ? newPath : newPath + '.qmd');
    updateLinkIndexForFile(pagesDir, newRel);
    updateSearchIndexForFile(pagesDir, newRel);
    res.status(201).json({ ok: true, path: newPath });
  });

  app.delete('/api/pages/*', (req: Request, res: Response) => {
    const filePath = guardPath(req.params[0] as string, res);
    if (!filePath) return;
    if (!existsSync(filePath)) return notFound(res, 'Page not found');

    // Soft-delete: move file to .quartostone/trash/ instead of permanent removal
    const trashDir = join(ctx.cwd, '.quartostone', 'trash');
    const id = randomUUID();
    const relPath = relative(pagesDir, filePath).replace(/\\/g, '/');
    try {
      mkdirSync(trashDir, { recursive: true });
      writeFileSync(
        join(trashDir, `${id}.meta.json`),
        JSON.stringify({ id, originalPath: relPath, name: relPath.replace(/\.qmd$/, ''), deletedAt: new Date().toISOString() }),
        'utf-8',
      );
      renameSync(filePath, join(trashDir, `${id}.qmd`));
    } catch {
      return serverError(res, 'Failed to delete page');
    }
    removeLinkIndexForFile(relPath);
    removeSearchIndexForFile(relPath);
    res.json({ ok: true, trashed: id });
  });

  // ── Directory management ─────────────────────────────────────────────────
  app.post('/api/directories', (req: Request, res: Response) => {
    const { path: folderPath } = req.body as { path?: string };
    if (!folderPath) return badRequest(res, 'path required');
    const abs = guardAnyPath(folderPath, res);
    if (!abs) return;
    if (existsSync(abs)) return conflict(res, 'Directory already exists');
    mkdirSync(abs, { recursive: true });
    res.status(201).json({ ok: true, path: folderPath });
  });

  app.delete('/api/directories/*', (req: Request, res: Response) => {
    const abs = guardAnyPath(req.params[0] as string, res);
    if (!abs) return;
    if (!existsSync(abs)) return notFound(res, 'Not found');
    try {
      rmdirSync(abs); // throws ENOTEMPTY if non-empty (atomic)
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOTEMPTY' || code === 'EEXIST') {
        return conflict(res, 'Directory is not empty');
      }
      if (code === 'ENOENT') {
        return notFound(res, 'Directory not found');
      }
      if (code === 'ENOTDIR') {
        return badRequest(res, 'Path is not a directory');
      }
      throw err;
    }
    res.json({ ok: true });
  });
}
