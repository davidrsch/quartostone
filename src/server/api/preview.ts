// src/server/api/preview.ts
// Live Quarto preview — spawns `quarto preview --no-browser` and proxies the port.
//
// POST /api/preview/start   body: { path, format? }  → { port, url }
// POST /api/preview/stop    body: { path }            → { ok }
// GET  /api/preview/status?path=                      → { running, url, port? }
// GET  /api/preview/ready?port=                       → { ready } (polls until port accepts connections)

import type { Express, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer, createConnection } from 'node:net';
import type { ServerContext } from '../context.js';
import { badRequest, notFound, serverError } from '../utils/errorResponse.js';
import { isInsideDir } from '../utils/pathGuard.js';
import { PREVIEW_FORMATS } from '../../shared/formats.js';
import { warn as logWarn, log, error as logError } from '../utils/logger.js';
import { sanitizeError } from '../utils/errorSanitizer.js';

// ─── #118 Quarto PATH detection ───────────────────────────────────────────────

async function resolveQuartoPath(): Promise<string | null> {
  // 1. Try the PATH-aware `which` / `where` asynchronously (never blocks the event loop)
  const fromPath = await new Promise<string | null>((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const child = spawn(cmd, ['quarto'], { stdio: 'pipe' });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) {
        const first = out.trim().split(/\r?\n/)[0]?.trim() ?? '';
        resolve(first && existsSync(first) ? first : null);
      } else {
        resolve(null);
      }
    });
    child.on('error', () => resolve(null));
  });

  if (fromPath) return fromPath;

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

// \u2500\u2500 Lazy quarto executable resolution \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

let _quartoExe: string | null | undefined = undefined; // undefined = not yet resolved

async function getQuartoExecutable(): Promise<string | null> {
  if (_quartoExe === undefined) {
    _quartoExe = await resolveQuartoPath();
    if (!_quartoExe) {
      logWarn('[preview] quarto not found in PATH — preview feature will be unavailable.');
    } else {
      log(`[preview] quarto detected at: ${_quartoExe}`);
    }
  }
  return _quartoExe;
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

const MAX_CONCURRENT_PREVIEWS = 5;
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
  exe:    string | null,
): PreviewProcess {
  const args = [
    'preview', absPath,
    '--no-browser',
    '--port', String(port),
    '--to', format,
  ];

  // Use resolved executable path for reliability (#118)
  const resolvedExe = exe ?? 'quarto';
  const proc = spawn(resolvedExe, args, { cwd, shell: process.platform === 'win32' && !exe });
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
    log(`[preview] quarto exited with code ${code} for ${relPath}`);
    previews.delete(relPath);
  });

  proc.on('error', (err) => {
    logError(`[preview] spawn error for ${relPath}: ${err.message}`);
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

/**
 * Registers the live-preview endpoints:
 *   POST /api/preview/start  — spawn `quarto preview` for a given file/format
 *   POST /api/preview/stop   — terminate one or all running preview processes
 *   GET  /api/preview/status — check whether a preview is active for a path
 *   GET  /api/preview/ready  — poll until the preview port accepts connections
 *
 * Preview processes are tracked in a per-file Map (keyed by resolved absolute
 * path). An existing preview for the same file and format is re-used rather than
 * respawned. Concurrent previews are capped at MAX_CONCURRENT_PREVIEWS (5).
 */
export function registerPreviewApi(app: Express, ctx: ServerContext) {
  const { cwd } = ctx;

  // POST /api/preview/start  body: { path: string; format?: string }
  app.post('/api/preview/start', async (req: Request, res: Response) => {
    // #118 \u2014 resolve quarto lazily (never blocks module load)
    const quartoExecutable = await getQuartoExecutable();
    // fail fast if quarto is not available
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

    if (!filePath) return badRequest(res, 'path is required');

    if (format && !PREVIEW_FORMATS.includes(format as typeof PREVIEW_FORMATS[number])) {
      return badRequest(res, 'Invalid format');
    }

    const absPath = join(cwd, filePath);
    if (!existsSync(absPath)) return notFound(res, 'File not found');

    const pagesRoot = resolve(join(cwd, ctx.config.pages_dir));
    if (!isInsideDir(pagesRoot, absPath)) {
      return badRequest(res, 'Path outside pages directory');
    }

    const key = resolve(cwd, filePath);
    // Re-use existing preview if same path and format
    const existing = previews.get(key);
    if (existing && existing.format === format) {
      return res.json({ port: existing.port, url: existing.url, reused: true });
    }

    // Stop any existing preview for this file (different format)
    if (existing) {
      try { existing.proc.kill(); } catch { /* ignore */ }
      previews.delete(key);
    }

    // S15: Limit concurrent previews
    if (previews.size >= MAX_CONCURRENT_PREVIEWS) {
      return res.status(429).json({ error: 'Too many concurrent previews. Stop an existing preview first.' });
    }

    const port   = await findFreePort();
    const entry  = startPreview(cwd, absPath, key, port, format, quartoExecutable);

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

    const key = resolve(cwd, filePath);
    const entry = previews.get(key);
    if (!entry) return res.json({ ok: true, wasRunning: false });

    try {
      entry.proc.kill();
    } catch { /* ignore */ }
    previews.delete(key);

    res.json({ ok: true, wasRunning: true });
  });

  // GET /api/preview/status?path=
  // Without path: returns overall running state (any preview active).
  // With path: returns state for a specific file preview.
  app.get('/api/preview/status', async (req: Request, res: Response) => {
    const exe = await getQuartoExecutable();
    const filePath = req.query['path'] as string | undefined;

    if (!filePath) {
      return res.json({ running: previews.size > 0, count: previews.size, quartoAvailable: !!exe });
    }

    const key = resolve(cwd, filePath);
    const entry = previews.get(key);
    if (!entry) return res.json({ running: false, quartoAvailable: !!exe });

    res.json({ running: true, url: entry.url, port: entry.port, format: entry.format });
  });

  // GET /api/preview/ready?port=<n>&timeout=<ms>
  // Polls until the Quarto preview server at <port> accepts a TCP connection.
  // Returns { ready: true } when up, { ready: false, timedOut: true } on timeout.
  app.get('/api/preview/ready', async (req: Request, res: Response) => {
    const port    = parseInt(req.query['port'] as string ?? '', 10);
    const rawTimeout = parseInt(String(req.query['timeout'] ?? ''), 10);
    const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(rawTimeout, 30000) : 5000;
    if (isNaN(port)) return badRequest(res, 'port is required');

    // SSRF guard: only allow polling ports that belong to active preview sessions
    const activeSessionPorts = new Set([...previews.values()].map(s => s.port));
    if (!activeSessionPorts.has(port)) {
      return badRequest(res, 'No active preview session on that port');
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
    if (!filePath) return badRequest(res, 'path is required');
    const key = resolve(cwd, filePath);
    const entry = previews.get(key);
    if (!entry) return res.json({ logs: [] });
    res.json({ logs: entry.logs.map(sanitizeError) });
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

/**
 * Preset the cached quarto executable path — for use in tests only.
 * Call this in `beforeEach` to bypass `resolveQuartoPath()` (which spawns a
 * real subprocess) and keep spawn mocks focused on the actual preview process.
 */
export function setQuartoExeForTest(exe: string | null | undefined): void {
  _quartoExe = exe;
}
