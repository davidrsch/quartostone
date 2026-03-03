// tests/unit/server/trash.test.ts
// Unit tests for the trash API: GET /api/trash, POST /api/trash/restore/:id,
// DELETE /api/trash/:id

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';
import type { TrashMeta } from '../../../src/server/api/trash.js';

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
};

let workspace: string;
let client: ReturnType<typeof supertest>;
let trashDir: string;
let pagesDir: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-trash-test-'));
  pagesDir = join(workspace, 'pages');
  trashDir = join(workspace, '.quartostone', 'trash');
  mkdirSync(pagesDir, { recursive: true });
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@t.com"', { cwd: workspace });
  execSync('git config user.name "test"', { cwd: workspace });

  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedTrashItem(id: string, originalPath: string, content = '# deleted'): TrashMeta {
  mkdirSync(trashDir, { recursive: true });
  const meta: TrashMeta = {
    id,
    originalPath,
    name: originalPath.replace(/\.qmd$/, ''),
    deletedAt: new Date().toISOString(),
  };
  writeFileSync(join(trashDir, `${id}.meta.json`), JSON.stringify(meta), 'utf-8');
  writeFileSync(join(trashDir, `${id}.qmd`), content, 'utf-8');
  return meta;
}

// ── GET /api/trash ────────────────────────────────────────────────────────────

describe('GET /api/trash', () => {
  it('returns an empty array when trash dir does not exist', async () => {
    const res = await client.get('/api/trash');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns trashed items sorted newest-first', async () => {
    const older = seedTrashItem('aaa', 'old.qmd');
    // Ensure second item has a later timestamp
    await new Promise(r => setTimeout(r, 5));
    const newer = seedTrashItem('bbb', 'new.qmd');

    const res = await client.get('/api/trash');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Sorted newest-first by deletedAt
    expect(res.body[0].id).toBe(newer.id);
    expect(res.body[1].id).toBe(older.id);
  });

  it('skips malformed meta files gracefully', async () => {
    mkdirSync(trashDir, { recursive: true });
    writeFileSync(join(trashDir, 'broken.meta.json'), '{not valid json', 'utf-8');
    seedTrashItem('ok1', 'good.qmd');

    const res = await client.get('/api/trash');
    expect(res.status).toBe(200);
    // Only the valid item is returned
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('ok1');
  });
});

// ── POST /api/trash/restore/:id ───────────────────────────────────────────────

describe('POST /api/trash/restore/:id', () => {
  it('restores a trashed file to its original path', async () => {
    seedTrashItem('r1', 'restored.qmd', '# Restored content');

    const res = await client.post('/api/trash/restore/r1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, path: 'restored.qmd' });
    // File should now exist in pages dir
    expect(existsSync(join(pagesDir, 'restored.qmd'))).toBe(true);
    // Meta and trashed file should be gone
    expect(existsSync(join(trashDir, 'r1.meta.json'))).toBe(false);
    expect(existsSync(join(trashDir, 'r1.qmd'))).toBe(false);
  });

  it('restores a trashed file into a subdirectory', async () => {
    seedTrashItem('r2', 'sub/nested.qmd', '# Nested');

    const res = await client.post('/api/trash/restore/r2');
    expect(res.status).toBe(200);
    expect(existsSync(join(pagesDir, 'sub', 'nested.qmd'))).toBe(true);
  });

  it('returns 404 when meta file does not exist', async () => {
    const res = await client.post('/api/trash/restore/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when meta exists but the .qmd file is missing', async () => {
    mkdirSync(trashDir, { recursive: true });
    const meta: TrashMeta = { id: 'nomf', originalPath: 'gone.qmd', name: 'gone', deletedAt: new Date().toISOString() };
    writeFileSync(join(trashDir, 'nomf.meta.json'), JSON.stringify(meta), 'utf-8');
    // No .qmd file written intentionally

    const res = await client.post('/api/trash/restore/nomf');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('returns 409 when the original path already exists in pages', async () => {
    seedTrashItem('r3', 'conflict.qmd');
    // Create the file at the original path to simulate conflict
    writeFileSync(join(pagesDir, 'conflict.qmd'), '# conflict', 'utf-8');

    const res = await client.post('/api/trash/restore/r3');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

// ── DELETE /api/trash/:id ─────────────────────────────────────────────────────

describe('DELETE /api/trash/:id', () => {
  it('permanently deletes a trashed item', async () => {
    seedTrashItem('del1', 'todelete.qmd');

    const res = await client.delete('/api/trash/del1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(existsSync(join(trashDir, 'del1.meta.json'))).toBe(false);
    expect(existsSync(join(trashDir, 'del1.qmd'))).toBe(false);
  });

  it('returns 404 when item is not found', async () => {
    const res = await client.delete('/api/trash/ghost');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('still succeeds when only meta exists and .qmd is already gone', async () => {
    mkdirSync(trashDir, { recursive: true });
    const meta: TrashMeta = { id: 'metaonly', originalPath: 'x.qmd', name: 'x', deletedAt: new Date().toISOString() };
    writeFileSync(join(trashDir, 'metaonly.meta.json'), JSON.stringify(meta), 'utf-8');
    // No .qmd file

    const res = await client.delete('/api/trash/metaonly');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
