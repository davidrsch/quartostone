// src/server/index.ts
// Lightweight Express server — file API, Git API, static site serving, WebSocket broadcaster

import express from 'express';
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
import { startWatcher } from './watcher.js';

// __dirname equivalent in ESM — resolves to dist/server/ after compilation
const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerContext {
  cwd: string;
  config: QuartostoneConfig;
  port: number;
}

export async function createServer(ctx: ServerContext) {
  const app = express();
  app.use(express.json());

  // Serve rendered site at /
  const siteDir = join(ctx.cwd, '_site');
  if (existsSync(siteDir)) {
    app.use('/', express.static(siteDir));
  }

  // Serve editor UI at /editor — built by Vite to dist/client/
  // __dirname is dist/server/ at runtime, so dist/client/ is one level up
  const editorDist = join(__dirname, '../client');
  if (existsSync(editorDist)) {
    app.use('/editor', express.static(editorDist));
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

  // Create HTTP + WebSocket server for live-reload
  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function broadcast(event: string, data?: unknown) {
    const msg = JSON.stringify({ event, data });
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(msg);
    });
  }

  // Start file watcher
  startWatcher({ ...ctx, broadcast });

  return httpServer;
}
