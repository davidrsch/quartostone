// src/server/index.ts
// Lightweight Express server — file API, Git API, static site serving, WebSocket broadcaster

import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { QuartostoneConfig } from './config.js';
import { registerPagesApi } from './api/pages.js';
import { registerGitApi } from './api/git.js';
import { registerRenderApi } from './api/render.js';
import { startWatcher } from './watcher.js';

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

  // Serve editor UI at /editor
  const editorDist = join(ctx.cwd, 'node_modules', 'quartostone', 'dist', 'client');
  if (existsSync(editorDist)) {
    app.use('/editor', express.static(editorDist));
  }

  // Register API routes
  registerPagesApi(app, ctx);
  registerGitApi(app, ctx);
  registerRenderApi(app, ctx);

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
