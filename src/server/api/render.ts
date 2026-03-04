// src/server/api/render.ts
// POST /api/render   — trigger quarto render

import type { Express, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ServerContext } from '../index.js';

export function registerRenderApi(app: Express, ctx: ServerContext) {
  app.post('/api/render', (req: Request, res: Response) => {
    const { path: filePath, scope } = req.body as { path?: string; scope?: 'file' | 'project' };

    // Validate scope
    if (scope !== undefined && scope !== 'file' && scope !== 'project') {
      return res.status(400).json({ error: 'Invalid scope' });
    }

    const renderScope = scope ?? ctx.config.render_scope;

    let renderTarget: string;
    if (renderScope === 'file') {
      // Validate filePath is a non-empty string
      if (typeof filePath !== 'string' || filePath.trim() === '') {
        return res.status(400).json({ error: 'filePath required when scope is file' });
      }

      const pagesRoot = resolve(join(ctx.cwd, ctx.config.pages_dir));
      const absPath = resolve(join(ctx.cwd, ctx.config.pages_dir, filePath));

      // Reject path traversal attacks
      const rel = relative(pagesRoot, absPath);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        return res.status(400).json({ error: 'Path outside pages directory' });
      }

      renderTarget = absPath;
    } else {
      renderTarget = ctx.cwd;
    }

    const child = spawn('quarto', ['render', renderTarget], {
      cwd: ctx.cwd,
      shell: false,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    // Timeout: kill the child process after 120 s
    const timer = setTimeout(() => {
      child.kill();
      res.status(500).json({ ok: false, error: 'Render timed out' });
    }, 120_000);

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (res.headersSent) return;
      if (code === 0) {
        res.json({ ok: true, output: stdout });
      } else {
        res.status(500).json({ ok: false, error: stderr || `quarto render exited with code ${code}` });
      }
    });
  });
}
