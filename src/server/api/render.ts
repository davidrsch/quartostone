// src/server/api/render.ts
// POST /api/render   — trigger quarto render

import type { Express, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { ServerContext } from '../index.js';
import { badRequest, serverError } from '../utils/errorResponse.js';
import { isInsideDir } from '../utils/pathGuard.js';

const RENDER_TIMEOUT_MS = 120_000; // max time to wait for quarto render before killing the process

export function registerRenderApi(app: Express, ctx: ServerContext) {
  app.post('/api/render', (req: Request, res: Response) => {
    let responded = false;
    const { path: filePath, scope } = req.body as { path?: string; scope?: 'file' | 'project' };

    // Validate scope
    if (scope !== undefined && scope !== 'file' && scope !== 'project') {
      responded = true;
      return badRequest(res, 'Invalid scope');
    }

    const renderScope = scope ?? ctx.config.render_scope;

    let renderTarget: string;
    if (renderScope === 'file') {
      // Validate filePath is a non-empty string
      if (typeof filePath !== 'string' || filePath.trim() === '') {
        responded = true;
        return badRequest(res, 'filePath required when scope is file');
      }

      const pagesRoot = resolve(join(ctx.cwd, ctx.config.pages_dir));

      // Reject path traversal attacks
      if (!isInsideDir(pagesRoot, filePath)) {
        responded = true;
        return badRequest(res, 'Path outside pages directory');
      }

      const absPath = resolve(pagesRoot, filePath);
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
      if (responded) return;
      child.kill();
      responded = true;
      res.status(500).json({ ok: false, error: 'Render timed out' });
    }, RENDER_TIMEOUT_MS);

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (responded) return;
      responded = true;
      if (code === 0) {
        res.json({ ok: true, output: stdout });
      } else {
        res.status(500).json({ ok: false, error: stderr || `quarto render exited with code ${code}` });
      }
    });
  });
}
