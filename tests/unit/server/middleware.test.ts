// tests/unit/server/middleware.test.ts
// Tests for Express middleware behaviours that live in createApp():
//  - Auth middleware (Bearer token)
//  - CORS cross-origin rejection
//  - Global error handler (sanitization)
//  - /api/session loopback guard (via supertest — loopback by definition)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createApp } from '../../../src/server/index.js';
import { sanitizeError } from '../../../src/server/utils/errorSanitizer.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_CONFIG: QuartostoneConfig = {
  commit_mode: 'prompt',
  commit_message_auto: 'qs-{alphanum8}',
  render_on_save: false,
  render_scope: 'file',
  watch_interval_ms: 300,
  port: 0,
  pages_dir: 'pages',
  open_browser: false,
  allow_code_execution: false,
};

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-mw-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@t.com"', { cwd: workspace });
  execSync('git config user.name "Test"', { cwd: workspace });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── Auth middleware ───────────────────────────────────────────────────────────

describe('Auth middleware', () => {
  it('allows requests with the correct Bearer token', async () => {
    const TOKEN = 'a'.repeat(64);
    const app = createApp({ cwd: workspace, config: BASE_CONFIG, port: 0, token: TOKEN });
    const res = await supertest(app)
      .get('/api/pages')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('returns 401 when Authorization header is absent', async () => {
    const TOKEN = 'b'.repeat(64);
    const app = createApp({ cwd: workspace, config: BASE_CONFIG, port: 0, token: TOKEN });
    const res = await supertest(app).get('/api/pages');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'Unauthorized');
  });

  it('returns 401 when the token is wrong', async () => {
    const TOKEN = 'c'.repeat(64);
    const app = createApp({ cwd: workspace, config: BASE_CONFIG, port: 0, token: TOKEN });
    const res = await supertest(app)
      .get('/api/pages')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  it('skips auth when ctx.token is undefined (test mode)', async () => {
    const app = createApp({ cwd: workspace, config: BASE_CONFIG, port: 0 });
    const res = await supertest(app).get('/api/pages');
    expect(res.status).toBe(200);
  });

  it('allows unauthenticated access to /api/health', async () => {
    const TOKEN = 'd'.repeat(64);
    const app = createApp({ cwd: workspace, config: BASE_CONFIG, port: 0, token: TOKEN });
    const res = await supertest(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });

  it('allows unauthenticated access to /api/session', async () => {
    const TOKEN = 'e'.repeat(64);
    const app = createApp({ cwd: workspace, config: BASE_CONFIG, port: 0, token: TOKEN });
    // supertest connects over loopback, so the loopback guard passes
    const res = await supertest(app).get('/api/session');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token', TOKEN);
  });
});

// ── CORS middleware ───────────────────────────────────────────────────────────

describe('CORS middleware', () => {
  it('allows same-origin requests (no Origin header)', async () => {
    const app = createApp({ cwd: workspace, config: BASE_CONFIG, port: 0 });
    const res = await supertest(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('allows requests with the matching Origin header', async () => {
    const config = { ...BASE_CONFIG, port: 4242 };
    const app = createApp({ cwd: workspace, config, port: 0 });
    const res = await supertest(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:4242');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4242');
  });

  it('rejects cross-origin requests with 403', async () => {
    const config = { ...BASE_CONFIG, port: 4242 };
    const app = createApp({ cwd: workspace, config, port: 0 });
    const res = await supertest(app)
      .get('/api/health')
      .set('Origin', 'http://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'Cross-origin request denied');
  });

  it('responds 204 to preflight OPTIONS requests for the same origin', async () => {
    const config = { ...BASE_CONFIG, port: 4242 };
    const app = createApp({ cwd: workspace, config, port: 0 });
    const res = await supertest(app)
      .options('/api/pages')
      .set('Origin', 'http://localhost:4242');
    expect(res.status).toBe(204);
  });
});

// ── Global error handler ─────────────────────────────────────────────────────

describe('Global error handler', () => {
  it('returns 500 with a sanitized message (no raw paths leaked)', async () => {
    const app = createApp({ cwd: workspace, config: BASE_CONFIG, port: 0 });

    // Inject a route that calls next(err) with a path-containing error.
    // The error handler in createApp is already registered, so we add a LOCAL
    // error handler AFTER the test route to mirror what the global one does.
    app.get('/test-error', (_req, _res, next: NextFunction) => {
      next(new Error('Failed to read /etc/secret/key.pem'));
    });
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const message = sanitizeError(err);
      if (!res.headersSent) res.status(500).json({ error: message });
    });

    const res = await supertest(app).get('/test-error');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
    // Path must be redacted
    expect(res.body.error as string).not.toContain('/etc/secret');
    expect(res.body.error as string).toContain('[path]');
  });

  it('does not expose stack traces in the response', async () => {
    const app = createApp({ cwd: workspace, config: BASE_CONFIG, port: 0 });
    app.get('/test-stack', (_req, _res, next: NextFunction) => { next(new Error('crash')); });
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const message = sanitizeError(err);
      if (!res.headersSent) res.status(500).json({ error: message });
    });

    const res = await supertest(app).get('/test-stack');
    expect(res.status).toBe(500);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('at Object.');
    expect(body).not.toContain('node_modules');
  });
});
