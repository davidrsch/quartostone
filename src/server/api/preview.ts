// src/server/api/preview.ts
// Live Quarto preview — spawns `quarto preview --no-browser` and proxies the port.
//
// POST /api/preview/start   body: { path, format? }  → { port, url }
// POST /api/preview/stop    body: { path }            → { ok }
// GET  /api/preview/status?path=                      → { running, url, port? }
// GET  /api/preview/ready?port=                       → { ready } (polls until port accepts connections)

import type { Express, Request, Response } from 'express';
import { spawn, execSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer, createConnection } from 'node:net';
import type { ServerContext } from '../index.js';

// ─── #118 Quarto PATH detection ───────────────────────────────────────────────

function resolveQuartoPath(): string | null {
  // 1. Try the PATH-aware `which` / `where`
  const cmd = process.platform === 'win32' ? 'where quarto' : 'which quarto';
  try {
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim();
    const first = out.split(/\r?\n/)[0].trim();
    if (first && existsSync(first)) return first;
  } catch { /* not in PATH */ }

  // 2. Common install paths
  const candidates: string[] = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Quarto\\bin\\quarto.cmd',
        'C:\\Program Files\\Quarto\\bin\\quarto.exe',
        join(process.env['LOCALAPPDATA'] ?? '', 'Programs\\Quarto\\bin\\quarto.cmd'),
      ]
    : [
        '/usr/local/bin/quarto',
        '/usr/bin/quarto',
        `${process.env['HOME'] ?? ''}/bin/quarto`,
        `${process.env['HOME'] ?? ''}/.local/bin/quarto`,
      ];

  for (const c of candidates) {
    try { if (existsSync(c)) return c; } catch { /* continue */ }
  }
  return null;
}

const quartoExecutable: string | null = resolveQuartoPath();
if (!quartoExecutable) {
  console.warn('[preview] quarto not found in PATH — preview feature will be unavailable.');
} else {
  console.info(`[preview] quarto detected at: ${quartoExecutable}`);
}

// ── Process registry ──────────────────────────────────────────────────────────

interface PreviewProcess {
  proc:   ChildProcess;
  port:   number;
  url:    string;
  path:   string;
  format: string;
  logs:   string[];
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

  // Use resolved executable path for reliability (#118)
  const exe = quartoExecutable ?? 'quarto';
  const proc = spawn(exe, args, { cwd, shell: process.platform === 'win32' && !quartoExecutable });
  const logs: string[] = [];

  const captureLog = (data: Buffer) => {
    const line = data.toString().trimEnd();
    logs.push(line);
    if (logs.length > 200) logs.shift(); // keep last 200 lines
  };

  // Drain stdout/stderr to avoid blocking
  proc.stdout?.on('data', captureLog);
  proc.stderr?.on('data', captureLog);

  proc.on('exit', (code) => {
    console.info(`[preview] quarto exited with code ${code} for ${relPath}`);
    previews.delete(relPath);
  });

  proc.on('error', (err) => {
    console.error(`[preview] spawn error for ${relPath}: ${err.message}`);
    previews.delete(relPath);
  });

  const entry: PreviewProcess = {
    proc,
    port,
    url: `http://localhost:${port}`,
    path: relPath,
    format,
    logs,
  };

  previews.set(relPath, entry);
  return entry;
}

// ── Register routes ───────────────────────────────────────────────────────────
const PREVIEW_FORMATS = ['html', 'revealjs', 'pdf', 'docx', 'pptx'] as const;
export function registerPreviewApi(app: Express, ctx: ServerContext) {
  const { cwd } = ctx;

  // POST /api/preview/start  body: { path: string; format?: string }
  app.post('/api/preview/start', async (req: Request, res: Response) => {
    // #118 — fail fast if quarto is not available
    if (!quartoExecutable) {
      return res.status(503).json({
        error: 'Quarto not found',
        detail: 'quarto is not installed or not on the system PATH.  ' +
                'Install Quarto from https://quarto.org and restart the server.',
      });
    }
    const { path: filePath, format = 'html' } = req.body as {
      path?:   string;
      format?: string;
    };

    if (!filePath) return res.status(400).json({ error: 'path is required' });

    if (format && !PREVIEW_FORMATS.includes(format as typeof PREVIEW_FORMATS[number])) {
      return res.status(400).json({ error: 'Invalid format' });
    }

    const absPath = join(cwd, filePath);
    if (!existsSync(absPath)) return res.status(404).json({ error: 'File not found' });

    const pagesDir = resolve(join(cwd, ctx.config.pages_dir));
    const abs = resolve(absPath);
    if (!abs.startsWith(pagesDir + sep) && abs !== pagesDir) {
      return res.status(400).json({ error: 'Path outside pages directory' });
    }

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

  // POST /api/preview/stop  body: { path?: string }
  // Without path: stops ALL running previews.
  // With path: stops only the preview for that file.
  app.post('/api/preview/stop', (req: Request, res: Response) => {
    const { path: filePath } = req.body as { path?: string };

    if (!filePath) {
      // Stop everything
      let stopped = 0;
      for (const [key, entry] of previews.entries()) {
        try { entry.proc.kill(); } catch { /* ignore */ }
        previews.delete(key);
        stopped++;
      }
      return res.json({ ok: true, stopped });
    }

    const entry = previews.get(filePath);
    if (!entry) return res.json({ ok: true, wasRunning: false });

    try {
      entry.proc.kill();
    } catch { /* ignore */ }
    previews.delete(filePath);

    res.json({ ok: true, wasRunning: true });
  });

  // GET /api/preview/status?path=
  // Without path: returns overall running state (any preview active).
  // With path: returns state for a specific file preview.
  app.get('/api/preview/status', (req: Request, res: Response) => {
    const filePath = req.query['path'] as string | undefined;

    if (!filePath) {
      return res.json({ running: previews.size > 0, count: previews.size, quartoAvailable: !!quartoExecutable });
    }

    const entry = previews.get(filePath);
    if (!entry) return res.json({ running: false, quartoAvailable: !!quartoExecutable });

    res.json({ running: true, url: entry.url, port: entry.port, format: entry.format });
  });

  // GET /api/preview/ready?port=<n>&timeout=<ms>
  // Polls until the Quarto preview server at <port> accepts a TCP connection.
  // Returns { ready: true } when up, { ready: false, timedOut: true } on timeout.
  app.get('/api/preview/ready', async (req: Request, res: Response) => {
    const port    = parseInt(req.query['port'] as string ?? '', 10);
    const rawTimeout = parseInt(String(req.query['timeout'] ?? ''), 10);
    const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(rawTimeout, 30000) : 5000;
    if (isNaN(port)) return res.status(400).json({ error: 'port is required' });

    // SSRF guard: only allow polling ports that belong to active preview sessions
    const activeSessionPorts = new Set([...previews.values()].map(s => s.port));
    if (!activeSessionPorts.has(port)) {
      return res.status(400).json({ error: 'No active preview session on that port' });
    }

    const deadline = Date.now() + timeoutMs;
    const poll = (): Promise<boolean> => new Promise(resolve => {
      if (Date.now() >= deadline) { resolve(false); return; }
      const sock = createConnection({ port, host: '127.0.0.1' });
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error',   () => { sock.destroy(); setTimeout(() => poll().then(resolve), 300); });
    });

    const ready = await poll();
    res.json({ ready, timedOut: !ready });
  });

  // GET /api/preview/logs?path=
  app.get('/api/preview/logs', (req: Request, res: Response) => {
    const filePath = req.query['path'] as string | undefined;
    if (!filePath) return res.status(400).json({ error: 'path is required' });
    const entry = previews.get(filePath);
    if (!entry) return res.json({ logs: [] });
    res.json({ logs: entry.logs });
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
