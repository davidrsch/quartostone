// src/server/api/trash.ts
// GET    /api/trash              — list all soft-deleted pages
// POST   /api/trash/restore/:id  — restore a page to its original path
// DELETE /api/trash/:id          — permanently destroy a trashed page

import type { Express, Request, Response } from 'express';
import {
  readdirSync, readFileSync, mkdirSync,
  existsSync, rmSync, renameSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import type { ServerContext } from '../index.js';
import { updateLinkIndexForFile } from './links.js';
import { updateSearchIndexForFile } from './search.js';

export interface TrashMeta {
  id: string;
  originalPath: string;
  name: string;
  deletedAt: string;
}

export function registerTrashApi(app: Express, ctx: ServerContext) {
  const pagesDir = join(ctx.cwd, ctx.config.pages_dir);
  const trashDir = join(ctx.cwd, '.quartostone', 'trash');

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
    const { id } = req.params;
    const metaPath  = join(trashDir, `${id}.meta.json`);
    const trashFile = join(trashDir, `${id}.qmd`);
    if (!existsSync(metaPath)) return res.status(404).json({ error: 'Trashed item not found' });

    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as TrashMeta;
    if (!existsSync(trashFile)) return res.status(404).json({ error: 'Trashed file missing from disk' });

    const target = join(pagesDir, meta.originalPath);
    if (existsSync(target)) {
      return res.status(409).json({ error: `Cannot restore: ${meta.originalPath} already exists` });
    }

    mkdirSync(dirname(target), { recursive: true });
    renameSync(trashFile, target);
    rmSync(metaPath);
    updateLinkIndexForFile(pagesDir, meta.originalPath);
    updateSearchIndexForFile(pagesDir, meta.originalPath);
    res.json({ ok: true, path: meta.originalPath });
  });

  app.delete('/api/trash/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const metaPath  = join(trashDir, `${id}.meta.json`);
    const trashFile = join(trashDir, `${id}.qmd`);
    if (!existsSync(metaPath)) return res.status(404).json({ error: 'Not found' });
    if (existsSync(trashFile)) rmSync(trashFile);
    rmSync(metaPath);
    res.json({ ok: true });
  });
}
