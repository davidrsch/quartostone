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
  allow_code_execution: false,
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

// Pre-generated UUID v4 fixtures for tests (real UUIDs pass the validation guard)
const UUIDS = {
  older:      '00000000-0000-4000-8000-000000000001',
  newer:      '00000000-0000-4000-8000-000000000002',
  okItem:     '00000000-0000-4000-8000-000000000003',
  restore1:   '00000000-0000-4000-8000-000000000004',
  restore2:   '00000000-0000-4000-8000-000000000005',
  conflict:   '00000000-0000-4000-8000-000000000006',
  noMeta:     '00000000-0000-4000-8000-000000000007',
  noQmd:      '00000000-0000-4000-8000-000000000008',
  del1:       '00000000-0000-4000-8000-000000000009',
  metaOnly:   '00000000-0000-4000-8000-00000000000a',
} as const;

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
    const older = seedTrashItem(UUIDS.older, 'old.qmd');
    // Ensure second item has a later timestamp
    await new Promise(r => setTimeout(r, 5));
    const newer = seedTrashItem(UUIDS.newer, 'new.qmd');

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
    seedTrashItem(UUIDS.okItem, 'good.qmd');

    const res = await client.get('/api/trash');
    expect(res.status).toBe(200);
    // Only the valid item is returned
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(UUIDS.okItem);
  });
});

// ── POST /api/trash/restore/:id ───────────────────────────────────────────────

describe('POST /api/trash/restore/:id', () => {
  it('restores a trashed file to its original path', async () => {
    seedTrashItem(UUIDS.restore1, 'restored.qmd', '# Restored content');

    const res = await client.post(`/api/trash/restore/${UUIDS.restore1}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, path: 'restored.qmd' });
    // File should now exist in pages dir
    expect(existsSync(join(pagesDir, 'restored.qmd'))).toBe(true);
    // Meta and trashed file should be gone
    expect(existsSync(join(trashDir, `${UUIDS.restore1}.meta.json`))).toBe(false);
    expect(existsSync(join(trashDir, `${UUIDS.restore1}.qmd`))).toBe(false);
  });

  it('restores a trashed file into a subdirectory', async () => {
    seedTrashItem(UUIDS.restore2, 'sub/nested.qmd', '# Nested');

    const res = await client.post(`/api/trash/restore/${UUIDS.restore2}`);
    expect(res.status).toBe(200);
    expect(existsSync(join(pagesDir, 'sub', 'nested.qmd'))).toBe(true);
  });

  it('returns 404 when meta file does not exist', async () => {
    const res = await client.post(`/api/trash/restore/${UUIDS.noMeta}`);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when meta exists but the .qmd file is missing', async () => {
    mkdirSync(trashDir, { recursive: true });
    const meta: TrashMeta = { id: UUIDS.noQmd, originalPath: 'gone.qmd', name: 'gone', deletedAt: new Date().toISOString() };
    writeFileSync(join(trashDir, `${UUIDS.noQmd}.meta.json`), JSON.stringify(meta), 'utf-8');
    // No .qmd file written intentionally

    const res = await client.post(`/api/trash/restore/${UUIDS.noQmd}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('returns 409 when the original path already exists in pages', async () => {
    seedTrashItem(UUIDS.conflict, 'conflict.qmd');
    // Create the file at the original path to simulate conflict
    writeFileSync(join(pagesDir, 'conflict.qmd'), '# conflict', 'utf-8');

    const res = await client.post(`/api/trash/restore/${UUIDS.conflict}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

// ── DELETE /api/trash/:id ─────────────────────────────────────────────────────

describe('DELETE /api/trash/:id', () => {
  it('permanently deletes a trashed item', async () => {
    seedTrashItem(UUIDS.del1, 'todelete.qmd');

    const res = await client.delete(`/api/trash/${UUIDS.del1}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(existsSync(join(trashDir, `${UUIDS.del1}.meta.json`))).toBe(false);
    expect(existsSync(join(trashDir, `${UUIDS.del1}.qmd`))).toBe(false);
  });

  it('returns 404 when item is not found', async () => {
    const res = await client.delete(`/api/trash/${UUIDS.noMeta}`);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('still succeeds when only meta exists and .qmd is already gone', async () => {
    mkdirSync(trashDir, { recursive: true });
    const meta: TrashMeta = { id: UUIDS.metaOnly, originalPath: 'x.qmd', name: 'x', deletedAt: new Date().toISOString() };
    writeFileSync(join(trashDir, `${UUIDS.metaOnly}.meta.json`), JSON.stringify(meta), 'utf-8');
    // No .qmd file

    const res = await client.delete(`/api/trash/${UUIDS.metaOnly}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
