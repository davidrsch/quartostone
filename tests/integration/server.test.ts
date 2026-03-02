// tests/integration/server.test.ts
// Integration tests for the Express API layer.
// Spins up the real Express app (without HTTP server / WebSocket) via Supertest
// against a temporary workspace that is also a real git repository.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createApp } from '../../src/server/index.js';
import type { QuartostoneConfig } from '../../src/server/config.js';

// ── Fixture setup ─────────────────────────────────────────────────────────────

let workspace: string;
let client: ReturnType<typeof supertest>;

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

beforeAll(() => {
  // Create temp workspace
  workspace = mkdtempSync(join(tmpdir(), 'qs-int-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });

  // Write a regular page
  writeFileSync(
    join(workspace, 'pages', 'hello.qmd'),
    '---\ntitle: Hello\n---\n\n# Hello World\n',
  );

  // Write a database page
  writeFileSync(
    join(workspace, 'pages', 'tasks.qmd'),
    [
      '---',
      'quartostone: database',
      'schema:',
      '  - id: name',
      '    name: Name',
      '    type: text',
      '  - id: done',
      '    name: Done',
      '    type: checkbox',
      '---',
      '',
      '| name   | done  |',
      '|--------|-------|',
      '| Task 1 | false |',
      '',
    ].join('\n'),
  );

  // Initialise a git repo so the git endpoints don't error
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@quartostone.test"', { cwd: workspace });
  execSync('git config user.name "Test"', { cwd: workspace });
  execSync('git add .', { cwd: workspace });
  execSync('git commit -m "initial"', { cwd: workspace });

  // Build the Express app under test
  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── GET /api/pages ────────────────────────────────────────────────────────────

describe('GET /api/pages', () => {
  it('returns 200 with an array of page nodes', async () => {
    const res = await client.get('/api/pages');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('includes the hello page in the tree', async () => {
    const res = await client.get('/api/pages');
    const names: string[] = res.body.map((n: { name: string }) => n.name);

    expect(names).toContain('hello');
  });
});

// ── GET /api/pages/:path ──────────────────────────────────────────────────────

describe('GET /api/pages/:path', () => {
  it('returns the raw .qmd content', async () => {
    // Path is relative to the pages directory, so just the filename
    const res = await client.get('/api/pages/hello.qmd');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('content');
    expect(res.body.content).toContain('Hello World');
  });

  it('returns 404 for a non-existent page', async () => {
    const res = await client.get('/api/pages/ghost.qmd');

    expect(res.status).toBe(404);
  });
});

// ── PUT /api/pages/:path ──────────────────────────────────────────────────────

describe('PUT /api/pages/:path', () => {
  it('writes new content to an existing page', async () => {
    const newContent = '---\ntitle: Hello\n---\n\n# Updated\n';

    const putRes = await client.put('/api/pages/hello.qmd').send({ content: newContent });
    expect(putRes.status).toBe(200);

    const getRes = await client.get('/api/pages/hello.qmd');
    expect(getRes.body.content).toContain('Updated');
  });

  it('creates a new page that did not exist before', async () => {
    const res = await client
      .put('/api/pages/new-page.qmd')
      .send({ content: '---\ntitle: New\n---\n# New\n' });

    expect(res.status).toBe(200);
  });
});

// ── GET /api/db ───────────────────────────────────────────────────────────────

describe('GET /api/db', () => {
  it('returns schema and rows for a valid database page', async () => {
    const res = await client.get('/api/db').query({ path: 'pages/tasks.qmd' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('schema');
    expect(res.body).toHaveProperty('rows');
    expect(Array.isArray(res.body.schema)).toBe(true);
    expect(res.body.schema[0]).toMatchObject({ id: 'name', type: 'text' });
    expect(res.body.rows[0]).toMatchObject({ name: 'Task 1' });
  });

  it('returns 400 when the path is not a database page', async () => {
    const res = await client.get('/api/db').query({ path: 'pages/hello.qmd' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a Quartostone database/i);
  });

  it('returns 400 when the path parameter is missing', async () => {
    const res = await client.get('/api/db');

    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent database file', async () => {
    const res = await client.get('/api/db').query({ path: 'pages/ghost.qmd' });

    expect(res.status).toBe(404);
  });
});

// ── PUT /api/db ───────────────────────────────────────────────────────────────

describe('PUT /api/db', () => {
  it('writes updated schema and rows, then GET returns them', async () => {
    const payload = {
      schema: [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'done', name: 'Done', type: 'checkbox' },
      ],
      rows: [
        { name: 'Task A', done: 'true' },
        { name: 'Task B', done: 'false' },
      ],
    };

    const putRes = await client.put('/api/db').query({ path: 'pages/tasks.qmd' }).send(payload);
    expect(putRes.status).toBe(200);

    const getRes = await client.get('/api/db').query({ path: 'pages/tasks.qmd' });
    expect(getRes.status).toBe(200);
    expect(getRes.body.rows).toHaveLength(2);
    expect(getRes.body.rows[0]).toMatchObject({ name: 'Task A' });
  });

  it('returns 400 when schema is not an array', async () => {
    const res = await client
      .put('/api/db')
      .query({ path: 'pages/tasks.qmd' })
      .send({ schema: 'oops', rows: [] });

    expect(res.status).toBe(400);
  });
});

// ── POST /api/exec — validation only ─────────────────────────────────────────

describe('POST /api/exec', () => {
  it('returns 400 when code is missing from the body', async () => {
    const res = await client.post('/api/exec').send({ language: 'python' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/code is required/i);
  });

  it('returns 400 when code is an empty string', async () => {
    const res = await client.post('/api/exec').send({ code: '   ', language: 'python' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an unsupported language', async () => {
    const res = await client.post('/api/exec').send({ code: 'print("hi")', language: 'cobol' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported language/i);
  });
});

// ── GET /api/git/status ───────────────────────────────────────────────────────

describe('GET /api/git/status', () => {
  it('returns 200 with git status fields', async () => {
    const res = await client.get('/api/git/status');

    expect(res.status).toBe(200);
    // simple-git status response has these fields
    expect(res.body).toHaveProperty('current');
    expect(res.body).toHaveProperty('files');
    expect(Array.isArray(res.body.files)).toBe(true);
  });
});

// ── GET /api/git/log ──────────────────────────────────────────────────────────

describe('GET /api/git/log', () => {
  it('returns an array of commits', async () => {
    const res = await client.get('/api/git/log');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('message');
    expect(res.body[0]).toHaveProperty('hash');
  });
});

// ── POST /api/pages ───────────────────────────────────────────────────────────

describe('POST /api/pages', () => {
  it('creates a new page with the given title', async () => {
    const res = await client
      .post('/api/pages')
      .send({ path: 'brand-new.qmd', title: 'Brand New' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true });
  });

  it('returns 409 when the page already exists', async () => {
    // Create it first
    await client.post('/api/pages').send({ path: 'duplicate.qmd', title: 'Dup' });
    // Try to create again
    const res = await client.post('/api/pages').send({ path: 'duplicate.qmd', title: 'Dup' });

    expect(res.status).toBe(409);
  });

  it('returns 400 when path is missing', async () => {
    const res = await client.post('/api/pages').send({ title: 'No path' });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/git/diff ─────────────────────────────────────────────────────────

describe('GET /api/git/diff', () => {
  it('returns working-tree diff when sha parameter is omitted', async () => {
    const res = await client.get('/api/git/diff');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('diff');
  });

  it('returns diff content for the initial commit sha', async () => {
    // Get the SHA from the log
    const logRes = await client.get('/api/git/log');
    const sha = logRes.body[0].hash as string;

    const res = await client.get('/api/git/diff').query({ sha });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('diff');
  });
});

// ── POST /api/git/commit ──────────────────────────────────────────────────────

describe('POST /api/git/commit', () => {
  it('returns 400 when message is missing', async () => {
    const res = await client.post('/api/git/commit').send({});

    expect(res.status).toBe(400);
  });

  it('commits any pending changes and returns a commit hash', async () => {
    // Write a new page so there is something to commit
    await client.put('/api/pages/commitable.qmd').send({ content: '# Commit me\n' });

    const res = await client.post('/api/git/commit').send({ message: 'test: integration commit' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(typeof res.body.commit).toBe('string');
  });
});
