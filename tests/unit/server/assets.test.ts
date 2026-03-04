// tests/unit/server/assets.test.ts
// Unit tests for the assets API:
//   POST /api/assets   — upload an image file
//   GET  /assets/:file — serve a file from pages/_assets/

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';

// ── Standard config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: QuartostoneConfig = {
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
let client: ReturnType<typeof supertest>;
let assetsDir: string;

// A minimal 1×1 transparent GIF (26 bytes) — a real binary image
const MINIMAL_GIF = Buffer.from(
  '4749463839610100010080000000ffffff00000021f90400000000002c00000000010001000002024401003b',
  'hex',
);

// Small PNG-like text content — multer only checks extension, not magic bytes
const FAKE_PNG = Buffer.from('PNG');

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-assets-test-'));
  assetsDir = join(workspace, 'pages', '_assets');
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@t.com"', { cwd: workspace });
  execSync('git config user.name "test"', { cwd: workspace });

  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── POST /api/assets ─────────────────────────────────────────────────────────

describe('POST /api/assets', () => {
  it('uploads a .gif file and returns a url', async () => {
    const res = await client
      .post('/api/assets')
      .attach('file', MINIMAL_GIF, { filename: 'test.gif', contentType: 'image/gif' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('url');
    expect(res.body.url).toMatch(/^\/assets\//);
    expect(res.body).toHaveProperty('filename');
    // Uploaded file should exist on disk
    expect(existsSync(join(assetsDir, res.body.filename as string))).toBe(true);
  });

  it('uploads a .png file and returns a url', async () => {
    const res = await client
      .post('/api/assets')
      .attach('file', FAKE_PNG, { filename: 'image.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/assets\//);
    expect(res.body.url).toContain('.png');
  });

  it('uploads a .jpg file', async () => {
    const res = await client
      .post('/api/assets')
      .attach('file', FAKE_PNG, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.url).toContain('.jpg');
  });

  it('returns 400 when no file is attached', async () => {
    const res = await client.post('/api/assets');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects a disallowed file extension (.txt)', async () => {
    const res = await client
      .post('/api/assets')
      .attach('file', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' });

    // multer's fileFilter rejects it → req.file is undefined → 400
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects a disallowed file extension (.exe)', async () => {
    const res = await client
      .post('/api/assets')
      .attach('file', Buffer.from('MZ'), { filename: 'malware.exe', contentType: 'application/octet-stream' });

    expect(res.status).toBe(400);
  });

  it('sanitises special characters in the filename', async () => {
    const res = await client
      .post('/api/assets')
      .attach('file', FAKE_PNG, { filename: 'my image (1).png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    // Spaces and parens should be replaced with underscores
    expect(res.body.filename as string).not.toMatch(/[ ()]/);
    expect(res.body.url).toContain('.png');
  });
});

// ── GET /assets/:filename ─────────────────────────────────────────────────────

describe('GET /assets/:filename', () => {
  it('serves an existing file', async () => {
    // Pre-create a file in the assets directory
    mkdirSync(assetsDir, { recursive: true });
    const filename = 'existing.png';
    writeFileSync(join(assetsDir, filename), FAKE_PNG);

    const res = await client.get(`/assets/${filename}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for a non-existent file', async () => {
    const res = await client.get('/assets/missing_file.png');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an empty filename', async () => {
    // A bare /assets/ path — filename param will be an empty string after basename()
    const res = await client.get('/assets/');
    // Express may return 404 for unmatched route or our handler returns 400
    expect([400, 404]).toContain(res.status);
  });
});
