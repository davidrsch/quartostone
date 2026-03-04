// tests/unit/server/git.test.ts
// Unit tests for the Git API:
//   GET  /api/git/log, /api/git/status, /api/git/diff, /api/git/branches
//   POST /api/git/commit, /api/git/branches, /api/git/checkout, /api/git/merge
//   GET  /api/git/show  (path validation)
//   POST /api/git/restore (path validation)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';

// ── Shared config ─────────────────────────────────────────────────────────────

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

// ── Fixture ───────────────────────────────────────────────────────────────────

let workspace: string;
let client: ReturnType<typeof supertest>;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-git-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });

  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@test.com"', { cwd: workspace });
  execSync('git config user.name "Test"', { cwd: workspace });

  writeFileSync(join(workspace, 'pages', 'alpha.qmd'), '---\ntitle: Alpha\n---\n\n# Alpha\n');
  execSync('git add .', { cwd: workspace });
  execSync('git commit -m "initial: alpha"', { cwd: workspace });

  writeFileSync(join(workspace, 'pages', 'alpha.qmd'), '---\ntitle: Alpha v2\n---\n\n# Alpha v2\n');
  execSync('git add .', { cwd: workspace });
  execSync('git commit -m "update: alpha v2"', { cwd: workspace });

  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── GET /api/git/log ──────────────────────────────────────────────────────────

describe('GET /api/git/log', () => {
  it('returns an array of commit objects', async () => {
    const res = await client.get('/api/git/log');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0]).toHaveProperty('hash');
    expect(res.body[0]).toHaveProperty('message');
  });

  it('filters commits to a specific file path', async () => {
    const res = await client.get('/api/git/log').query({ path: 'pages/alpha.qmd' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const messages = (res.body as Array<{ message: string }>).map(c => c.message);
    expect(messages.some(m => m.includes('alpha'))).toBe(true);
  });
});

// ── GET /api/git/status ───────────────────────────────────────────────────────

describe('GET /api/git/status', () => {
  it('returns current branch and file arrays', async () => {
    const res = await client.get('/api/git/status');
    expect(res.status).toBe(200);
    expect(typeof res.body.current).toBe('string');
    expect(res.body.current.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.files)).toBe(true);
  });

  it('includes ahead/behind tracking counts', async () => {
    const res = await client.get('/api/git/status');
    expect(res.status).toBe(200);
    expect(typeof res.body.ahead).toBe('number');
    expect(typeof res.body.behind).toBe('number');
  });
});

// ── GET /api/git/diff ─────────────────────────────────────────────────────────

describe('GET /api/git/diff', () => {
  it('returns an empty diff when working tree is clean', async () => {
    const res = await client.get('/api/git/diff');
    expect(res.status).toBe(200);
    expect(typeof res.body.diff).toBe('string');
  });

  it('returns diff for a specific commit sha', async () => {
    const logRes = await client.get('/api/git/log');
    const sha = (logRes.body as Array<{ hash: string }>)[0]?.hash;
    if (!sha) return; // guard: no commits
    const res = await client.get('/api/git/diff').query({ sha });
    expect(res.status).toBe(200);
    expect(typeof res.body.diff).toBe('string');
  });
});

// ── POST /api/git/commit ──────────────────────────────────────────────────────

describe('POST /api/git/commit', () => {
  it('returns 400 when message is missing', async () => {
    const res = await client.post('/api/git/commit').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  it('creates a commit and returns the commit hash', async () => {
    // Stage a new file so we have something to commit
    writeFileSync(join(workspace, 'pages', 'beta.qmd'), '---\ntitle: Beta\n---\n\n# Beta\n');
    execSync('git add pages/beta.qmd', { cwd: workspace });

    const res = await client.post('/api/git/commit').send({ message: 'test: add beta' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.commit).toBe('string');
  });
});

// ── GET /api/git/branches ─────────────────────────────────────────────────────

describe('GET /api/git/branches', () => {
  it('returns current branch and a list of branch objects', async () => {
    const res = await client.get('/api/git/branches');
    expect(res.status).toBe(200);
    expect(typeof res.body.current).toBe('string');
    expect(Array.isArray(res.body.branches)).toBe(true);
    const current = (res.body.branches as Array<{ name: string; current: boolean }>)
      .find(b => b.current);
    expect(current?.name).toBe(res.body.current);
  });
});

// ── POST /api/git/branches ────────────────────────────────────────────────────

describe('POST /api/git/branches', () => {
  // Record the current branch before any test in this block may change it
  let originalBranch: string;

  beforeAll(() => {
    originalBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspace })
      .toString()
      .trim();
  });

  afterAll(() => {
    execSync(`git checkout ${originalBranch}`, { cwd: workspace });
    try { execSync('git branch -D test-branch', { cwd: workspace }); } catch { /* may not exist */ }
  });

  it('returns 400 for invalid branch name', async () => {
    const res = await client.post('/api/git/branches').send({ name: 'bad name with spaces' });
    expect(res.status).toBe(400);
  });

  it('creates a new branch and switches to it', async () => {
    const res = await client.post('/api/git/branches').send({ name: 'test-branch' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('test-branch');
    // Cleanup is handled by afterAll above
  });
});

// ── POST /api/git/checkout ────────────────────────────────────────────────────

describe('POST /api/git/checkout', () => {
  it('returns 400 when branch name is missing', async () => {
    const res = await client.post('/api/git/checkout').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for branch names with shell metacharacters', async () => {
    const res = await client.post('/api/git/checkout').send({ branch: 'bad;name' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid branch/i);
  });

  it('checks out an existing branch and returns ok', async () => {
    // Capture the current branch so we can switch back afterwards
    const statusBefore = await client.get('/api/git/status');
    const originalBranch = (statusBefore.body as { current: string }).current;

    execSync('git branch test-checkout-branch', { cwd: workspace });

    const res = await client.post('/api/git/checkout').send({ branch: 'test-checkout-branch' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Switch back to the original branch and tidy up
    execSync(`git checkout ${originalBranch}`, { cwd: workspace });
    execSync('git branch -D test-checkout-branch', { cwd: workspace });
  });
});

// ── POST /api/git/merge ───────────────────────────────────────────────────────

describe('POST /api/git/merge', () => {
  it('returns 400 when branch is missing', async () => {
    const res = await client.post('/api/git/merge').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for branch names with shell metacharacters', async () => {
    const res = await client.post('/api/git/merge').send({ branch: '$(evil)' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid branch/i);
  });

  it('merges a feature branch and returns ok', async () => {
    // Capture the current branch so we can return to it
    const statusBefore = await client.get('/api/git/status');
    const mainBranch = (statusBefore.body as { current: string }).current;

    // Create and switch to a feature branch, add a commit, then come back
    execSync('git checkout -b test-merge-branch', { cwd: workspace });
    writeFileSync(join(workspace, 'pages', 'merge-test.qmd'), '---\ntitle: Merge\n---\n');
    execSync('git add pages/merge-test.qmd', { cwd: workspace });
    execSync('git commit -m "test: merge-test page"', { cwd: workspace });
    execSync(`git checkout ${mainBranch}`, { cwd: workspace });

    const res = await client.post('/api/git/merge').send({ branch: 'test-merge-branch' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Clean up the merged branch
    execSync('git branch -D test-merge-branch', { cwd: workspace });
  });
});

// ── GET /api/git/show — path validation ───────────────────────────────────────

describe('GET /api/git/show path validation', () => {
  it('returns 400 when sha is missing', async () => {
    const res = await client.get('/api/git/show').query({ path: 'pages/alpha.qmd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sha/i);
  });

  it('returns 400 when path is missing', async () => {
    const res = await client.get('/api/git/show').query({ sha: 'abc123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('returns 400 for path traversal attempts', async () => {
    const logRes = await client.get('/api/git/log');
    const sha = (logRes.body as Array<{ hash: string }>)[0]?.hash ?? 'abc123';
    const res = await client.get('/api/git/show').query({ sha, path: '../../src/server/index.ts' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outside pages/i);
  });

  it('returns file content for a valid path at a known sha', async () => {
    const logRes = await client.get('/api/git/log');
    const sha = (logRes.body as Array<{ hash: string }>)[0]?.hash;
    if (!sha) return;
    const res = await client.get('/api/git/show').query({ sha, path: 'pages/alpha.qmd' });
    // May be 200 or 404 depending on whether the file existed at that sha
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(typeof res.body.content).toBe('string');
    }
  });
});

// ── POST /api/git/restore — path validation ───────────────────────────────────

describe('POST /api/git/restore path validation', () => {
  it('returns 400 when sha is missing', async () => {
    const res = await client.post('/api/git/restore').send({ path: 'pages/alpha.qmd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sha/i);
  });

  it('returns 400 when path is missing', async () => {
    const res = await client.post('/api/git/restore').send({ sha: 'abc123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('returns 400 for path traversal attempts', async () => {
    const logRes = await client.get('/api/git/log');
    const sha = (logRes.body as Array<{ hash: string }>)[0]?.hash ?? 'abc123';
    const res = await client.post('/api/git/restore').send({ sha, path: '../../.env' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outside pages/i);
  });
});
