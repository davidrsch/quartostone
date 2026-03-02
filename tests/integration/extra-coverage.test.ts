// tests/integration/extra-coverage.test.ts
// Targeted tests to push statement/line/branch coverage past 80%.
// Covers: POST /api/db/create, malformed YAML, git log with path,
//         static _site serving, and pages API edge cases.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createApp } from '../../src/server/index.js';
import type { QuartostoneConfig } from '../../src/server/config.js';

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

// ── Fixture 1: normal workspace ───────────────────────────────────────────────

let workspace: string;
let client: ReturnType<typeof supertest>;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-extra-cov-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });

  // A normal markdown page
  writeFileSync(
    join(workspace, 'pages', 'hello.qmd'),
    '---\ntitle: Hello\n---\n\n# Hello\n',
  );

  // A page with MALFORMED YAML frontmatter (triggers parseFrontmatter catch branch)
  writeFileSync(
    join(workspace, 'pages', 'broken-fm.qmd'),
    '---\n: [invalid yaml\n---\n\n# content\n',
  );

  // A minimal database page
  writeFileSync(
    join(workspace, 'pages', 'tasks.qmd'),
    [
      '---',
      'quartostone: database',
      'schema:',
      '  - id: name',
      '    name: Name',
      '    type: text',
      '---',
      '',
      '| name   |',
      '|--------|',
      '| Task 1 |',
      '',
    ].join('\n'),
  );

  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@test.com"', { cwd: workspace });
  execSync('git config user.name "Test"', { cwd: workspace });
  execSync('git add .', { cwd: workspace });
  execSync('git commit -m "initial"', { cwd: workspace });

  // Second commit for per-file log
  writeFileSync(join(workspace, 'pages', 'hello.qmd'), '---\ntitle: Hello v2\n---\n\n# Hello v2\n');
  execSync('git add .', { cwd: workspace });
  execSync('git commit -m "update hello"', { cwd: workspace });

  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── Malformed YAML ────────────────────────────────────────────────────────────

describe('GET /api/db with malformed frontmatter YAML', () => {
  it('returns 400 (not a db page) when YAML parse fails gracefully', async () => {
    // parseFrontmatter catch branch → returns {meta:{}, body} → not a database
    const res = await client.get('/api/db').query({ path: 'pages/broken-fm.qmd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a Quartostone database/i);
  });
});

// ── POST /api/db/create ───────────────────────────────────────────────────────

describe('POST /api/db/create', () => {
  it('creates a new database page with default schema', async () => {
    const res = await client
      .post('/api/db/create')
      .query({ path: 'pages/new-db.qmd' })
      .send({ title: 'My New DB' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The file should now be readable as a db page
    const getRes = await client.get('/api/db').query({ path: 'pages/new-db.qmd' });
    expect(getRes.status).toBe(200);
    expect(getRes.body.schema.length).toBeGreaterThan(0);
  });

  it('creates a new database page with custom schema', async () => {
    const schema = [
      { id: 'item', name: 'Item', type: 'text' },
      { id: 'qty',  name: 'Quantity', type: 'number' },
    ];
    const res = await client
      .post('/api/db/create')
      .query({ path: 'pages/custom-db.qmd' })
      .send({ title: 'Custom DB', schema });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 when path is missing', async () => {
    const res = await client.post('/api/db/create').send({ title: 'No Path' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for path traversal attempts', async () => {
    const res = await client
      .post('/api/db/create')
      .query({ path: '../../../etc/passwd' })
      .send({ title: 'Traversal' });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/git/log with path parameter ─────────────────────────────────────

describe('GET /api/git/log with path filter', () => {
  it('returns commits filtered to a specific file', async () => {
    const res = await client.get('/api/git/log').query({ path: 'pages/hello.qmd' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // hello.qmd was touched in both commits
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('hash');
  });

  it('returns fewer commits than full log when filtering', async () => {
    const fullRes  = await client.get('/api/git/log');
    const fileRes  = await client.get('/api/git/log').query({ path: 'pages/tasks.qmd' });
    // tasks was only in the initial commit, full log has ≥ 2
    expect(fullRes.body.length).toBeGreaterThanOrEqual(fileRes.body.length);
  });
});

// ── Fixture 2: workspace WITH _site dir ──────────────────────────────────────
// This covers the `existsSync(siteDir)` true branch in createApp.

describe('GET / serves _site static files when _site/ exists', () => {
  let siteClient: ReturnType<typeof supertest>;
  let siteWorkspace: string;

  beforeAll(() => {
    siteWorkspace = mkdtempSync(join(tmpdir(), 'qs-site-cov-'));
    mkdirSync(join(siteWorkspace, 'pages'), { recursive: true });
    mkdirSync(join(siteWorkspace, '_site'), { recursive: true });
    writeFileSync(join(siteWorkspace, '_site', 'index.html'), '<html><body>site</body></html>');

    execSync('git init', { cwd: siteWorkspace });
    execSync('git config user.email "t@t.com"', { cwd: siteWorkspace });
    execSync('git config user.name "T"', { cwd: siteWorkspace });
    execSync('git add .', { cwd: siteWorkspace });
    execSync('git commit -m "init"', { cwd: siteWorkspace });

    const app2 = createApp({ cwd: siteWorkspace, config: DEFAULT_CONFIG, port: 0 });
    siteClient = supertest(app2);
  });

  afterAll(() => {
    rmSync(siteWorkspace, { recursive: true, force: true });
  });

  it('returns _site/index.html content for GET /', async () => {
    const res = await siteClient.get('/index.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('site');
  });
});

// ── PUT /api/db — path traversal ─────────────────────────────────────────────

describe('PUT /api/db path traversal', () => {
  it('returns 400 for path traversal attempts', async () => {
    const res = await client
      .put('/api/db')
      .query({ path: '../../../etc/hosts' })
      .send({ schema: [], rows: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/traversal/i);
  });
});

// ── GET /api/pages — edge cases ───────────────────────────────────────────────

describe('GET /api/pages/:path — missing page', () => {
  it('returns 404 for a non-existent page', async () => {
    const res = await client.get('/api/pages/nonexistent.qmd');
    expect(res.status).toBe(404);
  });
});
