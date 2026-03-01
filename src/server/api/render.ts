// src/server/api/render.ts
// POST /api/render   — trigger quarto render

import type { Express, Request, Response } from 'express';
import { exec } from 'node:child_process';
import { join } from 'node:path';
import type { ServerContext } from '../index.js';

export function registerRenderApi(app: Express, ctx: ServerContext) {
  app.post('/api/render', (req: Request, res: Response) => {
    const { path: filePath, scope } = req.body as { path?: string; scope?: 'file' | 'project' };
    const renderScope = scope ?? ctx.config.render_scope;

    let cmd: string;
    if (renderScope === 'file' && filePath) {
      const absPath = join(ctx.cwd, 'pages', filePath);
      cmd = `quarto render "${absPath}"`;
    } else {
      cmd = `quarto render "${ctx.cwd}"`;
    }

    exec(cmd, { cwd: ctx.cwd }, (error, stdout, stderr) => {
      if (error) {
        res.status(500).json({ ok: false, error: stderr || error.message });
      } else {
        res.json({ ok: true, output: stdout });
      }
    });
  });
}
