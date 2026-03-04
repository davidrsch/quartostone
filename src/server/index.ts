// src/server/index.ts
// Lightweight Express server — file API, Git API, static site serving, WebSocket broadcaster

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createServer as createHttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { QuartostoneConfig } from './config.js';
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

// __dirname equivalent in ESM — resolves to dist/server/ after compilation
const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerContext {
  cwd: string;
  config: QuartostoneConfig;
  port: number;
  /** Explicit path to the built editor client (dist/client/). Useful when the
   * server is loaded from source via tsx and __dirname resolves to src/server/
   * instead of the compiled dist/server/. */
  clientDist?: string;
}

/**
 * Create and configure the Express application with all API routes.
 * Exported separately so integration tests can use Supertest without a real HTTP server.
 */
export function createApp(ctx: ServerContext) {
  const app = express();
  app.use(express.json());

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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // Health-check endpoint — always returns 200. Used by Playwright webServer readiness probe.
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
  try { rebuildLinkIndex(pagesDir); } catch { /* empty workspace */ }
  try { rebuildSearchIndex(pagesDir); } catch { /* empty workspace */ }

  // Global error handler — must be registered LAST and must have exactly 4 params
  // so Express recognises it as an error handler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return app;
}

export async function createServer(ctx: ServerContext) {
  const app = createApp(ctx);

  // Create HTTP + WebSocket server for live-reload
  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

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

  return httpServer;
}
