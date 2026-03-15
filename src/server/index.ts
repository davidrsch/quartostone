// src/server/index.ts
// Lightweight Express server — file API, Git API, static site serving, WebSocket broadcaster

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { WebSocketServer } from 'ws';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export type { ServerContext } from './context.js';
import type { ServerContext } from './context.js';
import { registerPagesApi } from './api/pages.js';
import { registerGitApi } from './api/git.js';
import { registerRenderApi } from './api/render.js';
import { registerDbApi } from './api/db.js';
import { registerExecApi } from './api/exec.js';
import { registerExportApi } from './api/export.js';
import { registerPreviewApi } from './api/preview.js';
import { registerLinksApi, rebuildLinkIndex } from './api/links.js';
import { registerSearchApi, rebuildSearchIndex } from './api/search.js';
import { registerTrashApi } from './api/trash.js';
import { registerPandocApi } from './api/pandoc.js';
import { registerAssetsApi } from './api/assets.js';
import { registerXRefApi } from './api/xref.js';
import { startWatcher } from './watcher.js';
import { sanitizeError } from './utils/errorSanitizer.js';
import { warn } from './utils/logger.js';

// __dirname equivalent in ESM — resolves to dist/server/ after compilation
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Create and configure the Express application with all API routes.
 * Exported separately so integration tests can use Supertest without a real HTTP server.
 */
export function createApp(ctx: ServerContext) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Security headers — disable CSP and COEP to avoid breaking the editor UI
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  // CORS — only allow same-origin requests (localhost:port). Reject cross-origin requests.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigin = `http://localhost:${ctx.config.port}`;
    if (origin && origin !== allowedOrigin) {
      res.status(403).json({ error: 'Cross-origin request denied' });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // Health-check: kept inline as it's trivial and always stays here.
  // All other routes are registered via register*Api() helpers.
  // See A15 in __audit_arch.md for the rationale.
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Public endpoint: browser client calls this once on startup to obtain the session token.
  // Restricted to loopback connections — reachable only from the local machine.
  app.get('/api/session', (req: Request, res: Response) => {
    const addr = req.socket.remoteAddress;
    const isLoopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
    if (!isLoopback) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json({ token: ctx.token ?? null });
  });

  // Authentication middleware — enforces Bearer token on all /api/* routes.
  // Disabled in test mode when ctx.token is undefined or QUARTOSTONE_E2E is set.
  // /health and /session are always public.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (!ctx.token || process.env['QUARTOSTONE_E2E'] === 'true') { next(); return; }
    if (req.path === '/health' || req.path === '/session') { next(); return; }
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${ctx.token}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });

  // Rate limiting on expensive/long-running endpoints
  const expensiveLimiter = rateLimit({
    windowMs: 60_000,
    max: 10000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
  });
  app.use(['/api/render', '/api/export', '/api/exec', '/api/pandoc'], expensiveLimiter);

  // Rate limit git network operations (push/pull) — each involves external TCP I/O
  const gitNetworkLimiter = rateLimit({
    windowMs: 60_000,
    max: 10000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many git network requests, please slow down.' },
  });
  app.use(['/api/git/push', '/api/git/pull'], gitNetworkLimiter);

  // Serve rendered site at /
  const siteDir = join(ctx.cwd, '_site');
  if (existsSync(siteDir)) {
    app.use('/', express.static(siteDir));
  }

  // Serve editor UI at /editor — built by Vite to dist/client/
  // ctx.clientDist allows callers (e.g. the E2E fixture running via tsx) to
  // override the path when __dirname resolves to the TypeScript source tree.
  const editorDist = ctx.clientDist ?? join(__dirname, '../client');
  if (existsSync(editorDist)) {
    app.use('/editor', express.static(editorDist));

    // Serve standalone visual editor bundle
    // ctx.visualEditorDist allows overriding the path (needed for E2E tests)
    const visualEditorPath = ctx.visualEditorDist ?? join(ctx.cwd, '../quarto-visual-editor/dist');
    if (existsSync(visualEditorPath)) {
      app.use('/visual-editor', express.static(visualEditorPath));
    }

    // When no rendered site exists at /, serve the editor as the root app.
    // This covers fresh workspaces (no _site/ yet) and the E2E test fixture.
    if (!existsSync(siteDir)) {
      app.use('/', express.static(editorDist));
    }
  } else {
    app.get('/editor', (_req, res) =>
      res.send('<h2>Editor not built yet — run <code>npm run build:client</code></h2>')
    );
  }

  // Register API routes
  registerPagesApi(app, ctx);
  // GET /api/config — returns non-sensitive server configuration for the client
  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      pages_dir: ctx.config.pages_dir,
      commit_message_auto: ctx.config.commit_message_auto,
    });
  });
  registerGitApi(app, ctx);
  registerRenderApi(app, ctx);
  registerDbApi(app, ctx);
  registerExecApi(app, ctx);
  registerExportApi(app, ctx);
  registerPreviewApi(app, ctx);
  registerLinksApi(app, ctx);
  registerSearchApi(app, ctx);
  registerTrashApi(app, ctx);
  registerPandocApi(app, ctx);
  registerXRefApi(app, ctx);
  registerAssetsApi(app, ctx);

  // Build in-memory indexes on startup
  const pagesDir = join(ctx.cwd, ctx.config.pages_dir);
  try { rebuildLinkIndex(pagesDir); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn(`Link index build failed: ${sanitizeError(e)}`);
  }
  try { rebuildSearchIndex(pagesDir); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn(`Search index build failed: ${sanitizeError(e)}`);
  }

  // Global error handler — must be registered LAST and must have exactly 4 params
  // so Express recognises it as an error handler. sanitizeError strips paths/credentials
  // so internal details are never leaked to callers.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = sanitizeError(err);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return app;
}

export async function createServer(ctx: ServerContext): Promise<{ server: ReturnType<typeof createHttpServer>; token: string }> {
  const token = randomBytes(32).toString('hex');
  const app = createApp({ ...ctx, token });

  // Create HTTP + WebSocket server for live-reload
  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (_ws, req) => {
    // Validate Bearer token for WebSocket connections (prevents non-browser eavesdropping)
    // Use `token` (the variable generated in this scope), not ctx.token (which is undefined here).
    if (token) {
      const url = new URL(req.url ?? '', 'http://localhost');
      const t = url.searchParams.get('token');
      if (t !== token) {
        _ws.close(1008, 'Unauthorized');
        return;
      }
    }
    const origin = req.headers['origin'];
    const allowedOrigin = `http://localhost:${ctx.config.port}`;
    if (origin && origin !== allowedOrigin) {
      _ws.close(1008, 'Origin not allowed');
    }
  });

  function broadcast(event: string, data?: unknown) {
    const msg = JSON.stringify({ event, data });
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        try { client.send(msg); } catch { /* dropped connection — ignore */ }
      }
    });
  }

  // Start file watcher
  startWatcher({ ...ctx, broadcast });

  return { server: httpServer, token };
}
