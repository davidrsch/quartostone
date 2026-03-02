// src/server/api/preview.ts
// Live Quarto preview — spawns `quarto preview --no-browser` and proxies the port.
//
// POST /api/preview/start   body: { path, format? }  → { port, url }
// POST /api/preview/stop    body: { path }            → { ok }
// GET  /api/preview/status?path=                      → { running, url, port? }

import type { Express, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import type { ServerContext } from '../index.js';

// ── Process registry ──────────────────────────────────────────────────────────

interface PreviewProcess {
  proc:   ChildProcess;
  port:   number;
  url:    string;
  path:   string;
  format: string;
}

const previews = new Map<string, PreviewProcess>();

// Guard: only register the process.on('exit') cleanup once per process lifetime
let _exitListenerRegistered = false;

// ── Port allocation — find the next actually-free TCP port starting at 4400 ────

/** Returns a promise that resolves to a free local port ≥ startFrom. */
function findFreePort(startFrom = 4400): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', () => {
      // Port in use — try the next one
      server.close(() => findFreePort(startFrom + 1).then(resolve, reject));
    });
    server.listen(startFrom, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

// ── Spawn quarto preview ──────────────────────────────────────────────────────

function startPreview(
  cwd:    string,
  absPath: string,
  relPath: string,
  port:   number,
  format: string,
): PreviewProcess {
  const args = [
    'preview', absPath,
    '--no-browser',
    '--port', String(port),
    '--to', format,
  ];

  const proc = spawn('quarto', args, { cwd, shell: false });

  // Drain stdout/stderr to avoid blocking
  proc.stdout?.on('data', () => { /* consume */ });
  proc.stderr?.on('data', () => { /* consume */ });

  proc.on('exit', () => {
    previews.delete(relPath);
  });

  proc.on('error', () => {
    previews.delete(relPath);
  });

  const entry: PreviewProcess = {
    proc,
    port,
    url: `http://localhost:${port}`,
    path: relPath,
    format,
  };

  previews.set(relPath, entry);
  return entry;
}

// ── Register routes ───────────────────────────────────────────────────────────

export function registerPreviewApi(app: Express, ctx: ServerContext) {
  const { cwd } = ctx;

  // POST /api/preview/start  body: { path: string; format?: string }
  app.post('/api/preview/start', async (req: Request, res: Response) => {
    const { path: filePath, format = 'html' } = req.body as {
      path?:   string;
      format?: string;
    };

    if (!filePath) return res.status(400).json({ error: 'path is required' });

    const absPath = join(cwd, filePath);
    if (!existsSync(absPath)) return res.status(404).json({ error: 'File not found' });

    // Re-use existing preview if same path and format
    const existing = previews.get(filePath);
    if (existing && existing.format === format) {
      return res.json({ port: existing.port, url: existing.url, reused: true });
    }

    // Stop any existing preview for this file (different format)
    if (existing) {
      try { existing.proc.kill(); } catch { /* ignore */ }
      previews.delete(filePath);
    }

    const port   = await findFreePort();
    const entry  = startPreview(cwd, absPath, filePath, port, format);

    res.json({ port: entry.port, url: entry.url, reused: false });
  });

  // POST /api/preview/stop  body: { path: string }
  app.post('/api/preview/stop', (req: Request, res: Response) => {
    const { path: filePath } = req.body as { path?: string };
    if (!filePath) return res.status(400).json({ error: 'path is required' });

    const entry = previews.get(filePath);
    if (!entry) return res.json({ ok: true, wasRunning: false });

    try {
      entry.proc.kill();
    } catch { /* ignore */ }
    previews.delete(filePath);

    res.json({ ok: true, wasRunning: true });
  });

  // GET /api/preview/status?path=
  app.get('/api/preview/status', (req: Request, res: Response) => {
    const filePath = req.query['path'] as string | undefined;
    if (!filePath) return res.status(400).json({ error: 'path is required' });

    const entry = previews.get(filePath);
    if (!entry) return res.json({ running: false });

    res.json({ running: true, url: entry.url, port: entry.port, format: entry.format });
  });

  // Clean up all previews when the server shuts down (register at most once)
  if (!_exitListenerRegistered) {
    _exitListenerRegistered = true;
    process.on('exit', () => {
      for (const entry of previews.values()) {
        try { entry.proc.kill(); } catch { /* ignore */ }
      }
    });
  }
}

// ── Exported for testing ──────────────────────────────────────────────────────
export { previews };
