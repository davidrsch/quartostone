// src/server/api/trash.ts
// GET    /api/trash              — list all soft-deleted pages
// POST   /api/trash/restore/:id  — restore a page to its original path
// DELETE /api/trash/:id          — permanently destroy a trashed page

import type { Express, Request, Response } from 'express';
import {
  readdirSync, readFileSync, mkdirSync,
  existsSync, rmSync, renameSync, realpathSync,
} from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import type { ServerContext } from '../context.js';
import { badRequest, notFound, conflict, serverError } from '../utils/errorResponse.js';
import { sanitizeError } from '../utils/errorSanitizer.js';
import { updateLinkIndexForFile } from './links.js';
import { updateSearchIndexForFile } from './search.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TrashMeta {
  id: string;
  originalPath: string;
  name: string;
  deletedAt: string;
}

/**
 * Registers the trash (soft-delete) API:
 *   GET    /api/trash             — list all soft-deleted pages.
 *   POST   /api/trash/restore/:id — restore a page to its original path.
 *   DELETE /api/trash/:id         — permanently destroy a trashed page.
 *
 * Deleted files are moved to `.quartostone/trash/` with a UUID-named metadata
 * sidecar. Restoration prevents clobbering an existing live file.
 */
export function registerTrashApi(app: Express, ctx: ServerContext) {
  const pagesDir = join(ctx.cwd, ctx.config.pages_dir);
  const trashDir = join(ctx.cwd, '.quartostone', 'trash');
  let realPagesDir: string;
  try { realPagesDir = realpathSync(pagesDir); } catch { realPagesDir = resolve(pagesDir); }

  function listMeta(): TrashMeta[] {
    if (!existsSync(trashDir)) return [];
    return readdirSync(trashDir)
      .filter(f => f.endsWith('.meta.json'))
      .map(f => {
        try { return JSON.parse(readFileSync(join(trashDir, f), 'utf-8')) as TrashMeta; }
        catch { return null; }
      })
      .filter((m): m is TrashMeta => m !== null)
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  app.get('/api/trash', (_req: Request, res: Response) => {
    res.json(listMeta());
  });

  app.post('/api/trash/restore/:id', (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    if (!id || !UUID_RE.test(id)) return badRequest(res, 'Invalid id');
    const metaPath  = join(trashDir, `${id}.meta.json`);
    const trashFile = join(trashDir, `${id}.qmd`);
    if (!existsSync(metaPath)) return notFound(res, 'Trashed item not found');

    let meta: TrashMeta;
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as TrashMeta;
    } catch {
      return badRequest(res, 'Corrupted metadata file');
    }
    if (!existsSync(trashFile)) return notFound(res, 'Trashed file missing from disk');

    const restoreTarget = resolve(join(pagesDir, meta.originalPath));
    let realRestoreTarget: string;
    try { realRestoreTarget = realpathSync(restoreTarget); } catch { realRestoreTarget = restoreTarget; }
    if (!realRestoreTarget.startsWith(realPagesDir + sep) && realRestoreTarget !== realPagesDir) {
      return badRequest(res, 'Invalid restore path');
    }

    if (existsSync(restoreTarget)) {
      return conflict(res, `Cannot restore: ${meta.originalPath} already exists`);
    }

    mkdirSync(dirname(restoreTarget), { recursive: true });
    renameSync(trashFile, restoreTarget);
    try {
      rmSync(metaPath);
    } catch (err) {
      return serverError(res, sanitizeError(err));
    }
    updateLinkIndexForFile(pagesDir, meta.originalPath);
    updateSearchIndexForFile(pagesDir, meta.originalPath);
    res.json({ ok: true, path: meta.originalPath });
  });

  app.delete('/api/trash/:id', (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    if (!id || !UUID_RE.test(id)) return badRequest(res, 'Invalid id');
    const metaPath  = join(trashDir, `${id}.meta.json`);
    const trashFile = join(trashDir, `${id}.qmd`);
    if (!existsSync(metaPath)) return notFound(res, 'Not found');
    try {
      if (existsSync(trashFile)) rmSync(trashFile);
      rmSync(metaPath);
    } catch (err) {
      return serverError(res, String(err));
    }
    res.json({ ok: true });
  });
}
