// tests/unit/server/pages.test.ts
// Unit tests for the pages API.
//
// Covers: GET /api/pages, GET /api/pages/*, PUT /api/pages/*,
//         PATCH /api/pages/*, POST /api/pages, DELETE /api/pages/*,
//         POST /api/directories, DELETE /api/directories/*,
//         and the path-traversal guards.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync,
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
let pagesDir: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-pages-test-'));
  pagesDir = join(workspace, 'pages');
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

function writePage(relPath: string, content: string): void {
  const full = join(pagesDir, relPath);
  mkdirSync(join(pagesDir, relPath.replace(/[^/]+$/, '')), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

// ── GET /api/pages ────────────────────────────────────────────────────────────

describe('GET /api/pages', () => {
  it('returns an empty array for an empty pages directory', async () => {
    const res = await client.get('/api/pages');
    expect(res.status).toBe(200);
    // registerAssetsApi creates pages/_assets on startup; filter it out
    const nodes = (res.body as { name: string }[]).filter(n => n.name !== '_assets');
    expect(nodes).toEqual([]);
  });

  it('returns a file node for a single page', async () => {
    writePage('intro.qmd', '---\ntitle: Intro\n---\n\n# Intro\n');

    const res = await client.get('/api/pages');
    expect(res.status).toBe(200);
    const nodes = (res.body as { name: string }[]).filter(n => n.name !== '_assets');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ name: 'intro', path: 'intro.qmd', type: 'file' });
  });

  it('reads the icon from frontmatter', async () => {
    writePage('home.qmd', '---\ntitle: Home\nicon: house\n---\n');

    const res = await client.get('/api/pages');
    expect(res.status).toBe(200);
    const homeNode = (res.body as { name: string; icon?: string }[]).find(n => n.name === 'home');
    expect(homeNode).toBeDefined();
    expect(homeNode!.icon).toBe('house');
  });

  it('does not set icon when frontmatter has none', async () => {
    writePage('plain.qmd', '---\ntitle: Plain\n---\n');

    const res = await client.get('/api/pages');
    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty('icon');
  });

  it('reads icon with single-quoted value', async () => {
    writePage('quoted.qmd', "---\ntitle: Q\nicon: 'pencil'\n---\n");

    const res = await client.get('/api/pages');
    const node = (res.body as { name: string; icon?: string }[]).find(n => n.name === 'quoted');
    expect(node).toBeDefined();
    expect(node!.icon).toBe('pencil');
  });

  it('returns a folder node for a subdirectory', async () => {
    mkdirSync(join(pagesDir, 'docs'), { recursive: true });
    writePage('docs/readme.qmd', '---\ntitle: Readme\n---\n');

    const res = await client.get('/api/pages');
    expect(res.status).toBe(200);
    const folder = res.body.find((n: { name: string }) => n.name === 'docs');
    expect(folder).toBeDefined();
    expect(folder.type).toBe('folder');
    expect(folder.children).toHaveLength(1);
    expect(folder.children[0].name).toBe('readme');
  });

  it('ignores non-.qmd files in the pages directory', async () => {
    writeFileSync(join(pagesDir, 'notes.txt'), 'hello', 'utf-8');
    writePage('page.qmd', '---\ntitle: Page\n---\n');

    const res = await client.get('/api/pages');
    const nodes = (res.body as { name: string }[]).filter(n => n.name !== '_assets');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.name).toBe('page');
  });
});

// ── GET /api/pages/* ──────────────────────────────────────────────────────────

describe('GET /api/pages/*', () => {
  it('returns the page content', async () => {
    const content = '---\ntitle: Hello\n---\n\n# Hello\n';
    writePage('hello.qmd', content);

    const res = await client.get('/api/pages/hello');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe(content);
    expect(res.body.path).toBe('hello');
  });

  it('accepts a path with .qmd extension', async () => {
    writePage('hello.qmd', '# hi');

    const res = await client.get('/api/pages/hello.qmd');
    expect(res.status).toBe(200);
  });

  it('reads a file in a nested directory', async () => {
    writePage('sub/page.qmd', '# Sub');

    const res = await client.get('/api/pages/sub/page');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('# Sub');
  });

  it('returns 404 for a non-existent page', async () => {
    const res = await client.get('/api/pages/missing');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 or 404 for a path traversal attempt via URL', async () => {
    // Express normalises `../` in URLs before the app sees them, so the
    // traversal guard may not fire — accept both 400 and 404.
    const res = await client.get('/api/pages/../../etc/passwd');
    expect([400, 404]).toContain(res.status);
  });
});

// ── PUT /api/pages/* ──────────────────────────────────────────────────────────

describe('PUT /api/pages/*', () => {
  it('creates a new page file with the given content', async () => {
    const content = '---\ntitle: New\n---\n\n# New\n';
    const res = await client
      .put('/api/pages/new')
      .send({ content });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(existsSync(join(pagesDir, 'new.qmd'))).toBe(true);
  });

  it('overwrites an existing page', async () => {
    writePage('update.qmd', '# old');

    const res = await client
      .put('/api/pages/update')
      .send({ content: '# new content' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('creates parent directories as needed', async () => {
    const res = await client
      .put('/api/pages/sub/deep/page')
      .send({ content: '# deep' });

    expect(res.status).toBe(200);
    expect(existsSync(join(pagesDir, 'sub', 'deep', 'page.qmd'))).toBe(true);
  });

  it('returns 400 when content is missing', async () => {
    const res = await client.put('/api/pages/empty').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 or 404 for path traversal via URL', async () => {
    // Express normalises `../` in URLs; the guard may not fire.
    const res = await client
      .put('/api/pages/../../evil')
      .send({ content: 'pwned' });

    expect([400, 404]).toContain(res.status);
  });
});

// ── POST /api/pages ───────────────────────────────────────────────────────────

describe('POST /api/pages', () => {
  it('creates a new page with default frontmatter', async () => {
    const res = await client.post('/api/pages').send({ path: 'brand-new' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, path: 'brand-new' });
    expect(existsSync(join(pagesDir, 'brand-new.qmd'))).toBe(true);
  });

  it('uses the supplied title in the frontmatter', async () => {
    const res = await client.post('/api/pages').send({ path: 'titled', title: 'My Title' });
    expect(res.status).toBe(201);

    const content = readFileSync(join(pagesDir, 'titled.qmd'), 'utf-8');
    expect(content).toContain('title: "My Title"');
  });

  it('accepts a path that already ends in .qmd', async () => {
    const res = await client.post('/api/pages').send({ path: 'explicit.qmd' });
    expect(res.status).toBe(201);
    expect(existsSync(join(pagesDir, 'explicit.qmd'))).toBe(true);
  });

  it('returns 409 when the page already exists', async () => {
    writePage('exists.qmd', '# already here');

    const res = await client.post('/api/pages').send({ path: 'exists' });
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when path is missing from body', async () => {
    const res = await client.post('/api/pages').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('creates parent directories automatically', async () => {
    const res = await client.post('/api/pages').send({ path: 'a/b/c' });
    expect(res.status).toBe(201);
    expect(existsSync(join(pagesDir, 'a', 'b', 'c.qmd'))).toBe(true);
  });
});

// ── DELETE /api/pages/* (soft delete) ────────────────────────────────────────

describe('DELETE /api/pages/*', () => {
  it('soft-deletes a page to trash', async () => {
    writePage('bye.qmd', '# Bye');

    const res = await client.delete('/api/pages/bye');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('trashed');
    // File should no longer be in pages
    expect(existsSync(join(pagesDir, 'bye.qmd'))).toBe(false);
    // Trashed file and meta should exist
    const trashId = res.body.trashed as string;
    const trashDir = join(workspace, '.quartostone', 'trash');
    expect(existsSync(join(trashDir, `${trashId}.qmd`))).toBe(true);
    expect(existsSync(join(trashDir, `${trashId}.meta.json`))).toBe(true);
  });

  it('returns 404 for a page that does not exist', async () => {
    const res = await client.delete('/api/pages/ghost');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 or 404 for a path traversal attempt via URL', async () => {
    // Express normalises `../` in URLs; the guard may not fire.
    const res = await client.delete('/api/pages/../../evil');
    expect([400, 404]).toContain(res.status);
  });
});

// ── PATCH /api/pages/* (rename) ───────────────────────────────────────────────

describe('PATCH /api/pages/*', () => {
  it('renames a page file', async () => {
    writePage('old-name.qmd', '# Old');

    const res = await client
      .patch('/api/pages/old-name')
      .send({ newPath: 'new-name' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(existsSync(join(pagesDir, 'new-name.qmd'))).toBe(true);
    expect(existsSync(join(pagesDir, 'old-name.qmd'))).toBe(false);
  });

  it('renames a directory', async () => {
    mkdirSync(join(pagesDir, 'old-dir'), { recursive: true });
    writePage('old-dir/page.qmd', '# page');

    const res = await client
      .patch('/api/pages/old-dir')
      .send({ newPath: 'new-dir' });

    expect(res.status).toBe(200);
    expect(existsSync(join(pagesDir, 'new-dir', 'page.qmd'))).toBe(true);
    expect(existsSync(join(pagesDir, 'old-dir'))).toBe(false);
  });

  it('returns 400 when newPath is missing', async () => {
    writePage('page.qmd', '# page');

    const res = await client.patch('/api/pages/page').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when the source does not exist', async () => {
    const res = await client
      .patch('/api/pages/ghost')
      .send({ newPath: 'other' });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the target path already exists', async () => {
    writePage('src.qmd', '# src');
    writePage('dest.qmd', '# dest');

    const res = await client
      .patch('/api/pages/src')
      .send({ newPath: 'dest' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('returns 400 when newPath is a traversal', async () => {
    writePage('legit.qmd', '# legit');

    const res = await client
      .patch('/api/pages/legit')
      .send({ newPath: '../../outside' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/traversal/i);
  });
});

// ── POST /api/directories ─────────────────────────────────────────────────────

describe('POST /api/directories', () => {
  it('creates a new directory', async () => {
    const res = await client.post('/api/directories').send({ path: 'new-folder' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, path: 'new-folder' });
    expect(existsSync(join(pagesDir, 'new-folder'))).toBe(true);
  });

  it('creates nested directories', async () => {
    const res = await client.post('/api/directories').send({ path: 'a/b/c' });
    expect(res.status).toBe(201);
    expect(existsSync(join(pagesDir, 'a', 'b', 'c'))).toBe(true);
  });

  it('returns 409 when the directory already exists', async () => {
    mkdirSync(join(pagesDir, 'existing'), { recursive: true });

    const res = await client.post('/api/directories').send({ path: 'existing' });
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when path is missing', async () => {
    const res = await client.post('/api/directories').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for a path traversal attempt', async () => {
    const res = await client.post('/api/directories').send({ path: '../../escape' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/traversal/i);
  });
});

// ── DELETE /api/directories/* ─────────────────────────────────────────────────

describe('DELETE /api/directories/*', () => {
  it('deletes an empty directory', async () => {
    mkdirSync(join(pagesDir, 'empty-dir'), { recursive: true });

    const res = await client.delete('/api/directories/empty-dir');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(existsSync(join(pagesDir, 'empty-dir'))).toBe(false);
  });

  it('returns 404 for a non-existent directory', async () => {
    const res = await client.delete('/api/directories/ghost-dir');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 409 when the directory is not empty', async () => {
    mkdirSync(join(pagesDir, 'notempty'), { recursive: true });
    writePage('notempty/file.qmd', '# file');

    const res = await client.delete('/api/directories/notempty');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not empty/i);
  });

  it('returns 400 or 404 for a path traversal attempt via URL', async () => {
    // Express normalises `../` in URLs; the guard may not fire.
    const res = await client.delete('/api/directories/../../escape');
    expect([400, 404]).toContain(res.status);
  });

  it('returns 400 when path resolves to a file not a directory', async () => {
    writePage('afile.qmd', '# file');

    // Attempt to delete what is actually a file (readdirSync will fail → 400)
    const res = await client.delete('/api/directories/afile.qmd');
    expect([400, 404]).toContain(res.status); // File-not-a-directory must be rejected, not accepted
  });
});

// ── GET /api/pages — deep nesting (3+ levels) ─────────────────────────────────

describe('GET /api/pages — 3+ level nesting', () => {
  it('returns a correctly-structured 3-level nested tree', async () => {
    mkdirSync(join(pagesDir, 'top', 'mid', 'bottom'), { recursive: true });
    writePage('top/mid/bottom/deep.qmd', '---\ntitle: Deep\n---\n\n# Deep\n');

    const res = await client.get('/api/pages');
    expect(res.status).toBe(200);

    const topFolder = (res.body as { name: string; type: string; children: unknown[] }[])
      .find(n => n.name === 'top');
    expect(topFolder).toBeDefined();
    expect(topFolder!.type).toBe('folder');

    const midFolder = (topFolder!.children as { name: string; type: string; children: unknown[] }[])
      .find(n => n.name === 'mid');
    expect(midFolder).toBeDefined();
    expect(midFolder!.type).toBe('folder');

    const bottomFolder = (midFolder!.children as { name: string; type: string; children: { name: string }[] }[])
      .find(n => n.name === 'bottom');
    expect(bottomFolder).toBeDefined();
    expect(bottomFolder!.type).toBe('folder');
    expect(bottomFolder!.children[0]?.name).toBe('deep');
  });

  it('returns all files and folders at each level of a 3-level tree', async () => {
    // Two siblings at the top level, each with nested structure
    mkdirSync(join(pagesDir, 'branch1', 'sub'), { recursive: true });
    mkdirSync(join(pagesDir, 'branch2', 'sub'), { recursive: true });
    writePage('branch1/page.qmd', '---\ntitle: B1 Root\n---\n');
    writePage('branch1/sub/child.qmd', '---\ntitle: B1 Child\n---\n');
    writePage('branch2/page.qmd', '---\ntitle: B2 Root\n---\n');
    writePage('branch2/sub/child.qmd', '---\ntitle: B2 Child\n---\n');

    const res = await client.get('/api/pages');
    expect(res.status).toBe(200);

    const body = res.body as { name: string; type: string; children: { name: string; type: string; children: { name: string }[] }[] }[];
    const b1 = body.find(n => n.name === 'branch1');
    const b2 = body.find(n => n.name === 'branch2');
    expect(b1).toBeDefined();
    expect(b2).toBeDefined();

    // Each branch should have a file and a folder with a child
    expect(b1!.children.some(c => c.name === 'page')).toBe(true);
    const b1Sub = b1!.children.find(c => c.name === 'sub');
    expect(b1Sub?.type).toBe('folder');
    expect(b1Sub?.children.some(c => c.name === 'child')).toBe(true);
  });
});

// ── PATCH /api/pages — newPath already has .qmd extension ────────────────────

describe('PATCH /api/pages — newPath with .qmd extension', () => {
  it('does not double-append .qmd when newPath already ends with .qmd', async () => {
    writePage('original.qmd', '# Original');

    const res = await client
      .patch('/api/pages/original')
      .send({ newPath: 'renamed.qmd' });

    expect(res.status).toBe(200);
    // File should be at renamed.qmd, not renamed.qmd.qmd
    expect(existsSync(join(pagesDir, 'renamed.qmd'))).toBe(true);
    expect(existsSync(join(pagesDir, 'renamed.qmd.qmd'))).toBe(false);
    expect(existsSync(join(pagesDir, 'original.qmd'))).toBe(false);
  });

  it('newPath with .qmd extension is treated the same as without', async () => {
    writePage('alpha.qmd', '# Alpha');

    // One request uses .qmd suffix, the other does not — both should point to
    // the exact same target file.
    const resWithExt    = await client.patch('/api/pages/alpha').send({ newPath: 'beta.qmd' });
    writePage('gamma.qmd', '# Gamma');
    const resWithoutExt = await client.patch('/api/pages/gamma').send({ newPath: 'delta' });

    expect(resWithExt.status).toBe(200);
    expect(resWithoutExt.status).toBe(200);
    expect(existsSync(join(pagesDir, 'beta.qmd'))).toBe(true);
    expect(existsSync(join(pagesDir, 'delta.qmd'))).toBe(true);
  });
});
