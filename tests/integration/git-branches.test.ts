// tests/integration/git-branches.test.ts
// Integration tests for Phase 5 git endpoints:
//   GET  /api/git/branches
//   POST /api/git/branches   (create branch)
//   POST /api/git/checkout   (switch branch)
//   POST /api/git/merge      (merge branch)
//   GET  /api/git/show       (file content at commit)
//   POST /api/git/restore    (restore file to commit)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createApp } from '../../src/server/index.js';
import type { QuartostoneConfig } from '../../src/server/config.js';

// ── Fixture ───────────────────────────────────────────────────────────────────

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
let initialSha: string;
let secondSha: string;

beforeAll(() => {
  // Create temp workspace with git repo
  workspace = mkdtempSync(join(tmpdir(), 'qs-git-phase5-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });

  writeFileSync(
    join(workspace, 'pages', 'hello.qmd'),
    '---\ntitle: Hello\n---\n\n# Hello World v1\n',
  );

  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@quartostone.test"', { cwd: workspace });
  execSync('git config user.name "Test User"', { cwd: workspace });
  execSync('git add .', { cwd: workspace });
  execSync('git commit -m "initial commit"', { cwd: workspace });
  initialSha = execSync('git rev-parse HEAD', { cwd: workspace }).toString().trim();

  // Make a second commit on main so we have history to show/restore
  writeFileSync(
    join(workspace, 'pages', 'hello.qmd'),
    '---\ntitle: Hello\n---\n\n# Hello World v2\n',
  );
  execSync('git add .', { cwd: workspace });
  execSync('git commit -m "second commit"', { cwd: workspace });
  secondSha = execSync('git rev-parse HEAD', { cwd: workspace }).toString().trim();

  // Build app
  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── GET /api/git/branches ─────────────────────────────────────────────────────

describe('GET /api/git/branches', () => {
  it('returns current branch and branches array', async () => {
    const res = await client.get('/api/git/branches');
    expect(res.status).toBe(200);
    expect(typeof res.body.current).toBe('string');
    expect(Array.isArray(res.body.branches)).toBe(true);
    expect(res.body.branches.length).toBeGreaterThanOrEqual(1);
  });

  it('each branch entry has name, current, sha, date fields', async () => {
    const res = await client.get('/api/git/branches');
    const branch = res.body.branches[0] as { name: string; current: boolean; sha: string; date: string };
    expect(branch).toHaveProperty('name');
    expect(branch).toHaveProperty('current');
    expect(typeof branch.current).toBe('boolean');
    expect(branch).toHaveProperty('sha');
    expect(branch).toHaveProperty('date');
  });

  it('marks exactly one branch as current', async () => {
    const res = await client.get('/api/git/branches');
    const currentBranches = (res.body.branches as { current: boolean }[]).filter(b => b.current);
    expect(currentBranches.length).toBe(1);
    expect(currentBranches[0]!.current).toBe(true);
  });

  it('current field matches the top-level current property', async () => {
    const res = await client.get('/api/git/branches');
    const currentBranch = (res.body.branches as { name: string; current: boolean }[]).find(b => b.current);
    expect(currentBranch?.name).toBe(res.body.current);
  });
});

// ── POST /api/git/branches ────────────────────────────────────────────────────

describe('POST /api/git/branches', () => {
  it('creates and checks out a new branch', async () => {
    const res = await client.post('/api/git/branches').send({ name: 'feature-test-1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('feature-test-1');

    // Verify we are on the new branch
    const branchRes = await client.get('/api/git/branches');
    expect(branchRes.body.current).toBe('feature-test-1');
  });

  it('returns 400 when branch name is missing', async () => {
    const res = await client.post('/api/git/branches').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/branch name/i);
  });

  it('returns 400 for an invalid branch name (spaces)', async () => {
    const res = await client.post('/api/git/branches').send({ name: 'bad branch name' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/git/checkout ────────────────────────────────────────────────────

describe('POST /api/git/checkout', () => {
  it('switches to an existing branch', async () => {
    // Ensure we have a branch to switch to — create one on main first
    // (We may already be on feature-test-1 from previous test)
    // Switch back to main/master
    const statusRes = await client.get('/api/git/branches');
    const mainBranch = (statusRes.body.branches as { name: string; current: boolean }[])
      .find(b => b.name === 'main' || b.name === 'master');

    // If we're already on main-like branch, create & switch to feature
    const targetBranch = mainBranch && !mainBranch.current ? mainBranch.name : 'feature-test-1';

    const res = await client.post('/api/git/checkout').send({ branch: targetBranch });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.branch).toBe(targetBranch);
  });

  it('returns 400 when branch is missing', async () => {
    const res = await client.post('/api/git/checkout').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/branch/i);
  });

  it('returns 500 when switching to a non-existent branch', async () => {
    const res = await client.post('/api/git/checkout').send({ branch: 'does-not-exist-xyz' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /api/git/merge ───────────────────────────────────────────────────────

describe('POST /api/git/merge', () => {
  it('merges a branch into current (no-ff)', async () => {
    // Create a branch with a commit, then merge it into main
    // First get back to main/master
    const branchesRes = await client.get('/api/git/branches');
    const branches = branchesRes.body.branches as { name: string; current: boolean }[];
    const mainLike = branches.find(b => b.name === 'main' || b.name === 'master');

    if (mainLike) {
      await client.post('/api/git/checkout').send({ branch: mainLike.name });
    }

    // Create a new branch and add a commit to it
    await client.post('/api/git/branches').send({ name: 'merge-me' });
    writeFileSync(join(workspace, 'pages', 'extra.qmd'), '---\ntitle: Extra\n---\n');
    execSync('git add .', { cwd: workspace });
    execSync('git commit -m "extra page"', { cwd: workspace });

    // Switch back to main
    const currentName = mainLike?.name ?? 'main';
    await client.post('/api/git/checkout').send({ branch: currentName });

    const res = await client.post('/api/git/merge').send({ branch: 'merge-me' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 when branch is missing', async () => {
    const res = await client.post('/api/git/merge').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/branch/i);
  });
});

// ── GET /api/git/show ─────────────────────────────────────────────────────────

describe('GET /api/git/show', () => {
  it('returns file content at a specific commit', async () => {
    const res = await client.get(`/api/git/show?sha=${initialSha}&path=pages/hello.qmd`);
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('Hello World v1');
    expect(res.body.sha).toBe(initialSha);
    expect(res.body.path).toBe('pages/hello.qmd');
  });

  it('returns different content for different commits', async () => {
    const res1 = await client.get(`/api/git/show?sha=${initialSha}&path=pages/hello.qmd`);
    const res2 = await client.get(`/api/git/show?sha=${secondSha}&path=pages/hello.qmd`);
    expect(res1.body.content).toContain('v1');
    expect(res2.body.content).toContain('v2');
    expect(res1.body.content).not.toBe(res2.body.content);
  });

  it('returns 400 when sha is missing', async () => {
    const res = await client.get('/api/git/show?path=pages/hello.qmd');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sha/i);
  });

  it('returns 400 when path is missing', async () => {
    const res = await client.get(`/api/git/show?sha=${initialSha}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('returns 404 for a non-existent path at a commit', async () => {
    const res = await client.get(`/api/git/show?sha=${initialSha}&path=pages/no-such-file.qmd`);
    expect(res.status).toBe(404);
  });
});

// ── POST /api/git/restore ─────────────────────────────────────────────────────

describe('POST /api/git/restore', () => {
  it('restores a file to its content at the given commit', async () => {
    // The file currently has v2 content; restore to v1
    const res = await client.post('/api/git/restore').send({ sha: initialSha, path: 'pages/hello.qmd' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sha).toBe(initialSha);
    expect(res.body.path).toBe('pages/hello.qmd');

    // Verify the working tree file was updated
    const content = readFileSync(join(workspace, 'pages', 'hello.qmd'), 'utf8');
    expect(content).toContain('Hello World v1');
  });

  it('returns 400 when sha is missing', async () => {
    const res = await client.post('/api/git/restore').send({ path: 'pages/hello.qmd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sha/i);
  });

  it('returns 400 when path is missing', async () => {
    const res = await client.post('/api/git/restore').send({ sha: initialSha });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });
});

// ── GET /api/git/remote ───────────────────────────────────────────────────────

describe('GET /api/git/remote', () => {
  it('returns 200 even when no remote is configured', async () => {
    const res = await client.get('/api/git/remote');
    expect(res.status).toBe(200);
  });

  it('response has expected shape', async () => {
    const res = await client.get('/api/git/remote');
    expect(res.body).toHaveProperty('url');
    expect(res.body).toHaveProperty('branch');
    expect(res.body).toHaveProperty('ahead');
    expect(res.body).toHaveProperty('behind');
  });

  it('url is empty string when no remote', async () => {
    const res = await client.get('/api/git/remote');
    expect(res.body.url).toBe('');
  });
});

// ── PATCH /api/git/remote ─────────────────────────────────────────────────────

describe('PATCH /api/git/remote', () => {
  it('returns 400 when url is missing', async () => {
    const res = await client.patch('/api/git/remote').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });

  it('adds a remote origin when none exists', async () => {
    const res = await client
      .patch('/api/git/remote')
      .send({ url: 'https://github.com/example/repo.git' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('updates the remote url when origin already exists', async () => {
    // After previous test, origin is set — now set-url should succeed
    const res = await client
      .patch('/api/git/remote')
      .send({ url: 'https://github.com/example/repo2.git' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── POST /api/git/checkout — stash auto-apply ─────────────────────────────────

describe('POST /api/git/checkout — with dirty workspace', () => {
  it('auto-stashes dirty changes and re-applies after switching', async () => {
    // Ensure we are on a branch that has another sibling branch to switch to
    const branchRes = await client.get('/api/git/branches');
    const branches = branchRes.body.branches as { name: string; current: boolean }[];
    if (branches.length < 2) {
      // Create a sibling branch to switch to
      await client.post('/api/git/branches').send({ name: 'stash-target' });
      // Switch back to initial branch
      const initialBranch = branches.find(b => b.current)!.name;
      await client.post('/api/git/checkout').send({ branch: initialBranch });
    }

    // Get current and another branch
    const afterRes = await client.get('/api/git/branches');
    const afterBranches = afterRes.body.branches as { name: string; current: boolean }[];
    const currentBranch = afterBranches.find(b => b.current)!;
    const otherBranch   = afterBranches.find(b => !b.current);
    if (!otherBranch) return; // guard

    // Create an uncommitted change (dirty workspace)
    writeFileSync(join(workspace, 'pages', 'dirty.qmd'), '# Dirty file\n');
    execSync('git add .', { cwd: workspace }); // stage it but don't commit

    // Switch branch — should auto-stash
    const res = await client.post('/api/git/checkout').send({ branch: otherBranch.name });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.stashed).toBe(true);

    // Switch back
    await client.post('/api/git/checkout').send({ branch: currentBranch.name });
  });
});

// ── POST /api/git/merge — custom message ─────────────────────────────────────

describe('POST /api/git/merge — options', () => {
  it('accepts a custom merge commit message', async () => {
    // Create a new branch with a commit then merge with custom message
    const branchRes = await client.get('/api/git/branches');
    const current = branchRes.body.current as string;

    await client.post('/api/git/branches').send({ name: 'custom-msg-branch' });
    writeFileSync(join(workspace, 'pages', 'custom-msg.qmd'), '# Custom\n');
    execSync('git add .', { cwd: workspace });
    execSync('git commit -m "custom msg branch commit"', { cwd: workspace });

    await client.post('/api/git/checkout').send({ branch: current });

    const res = await client.post('/api/git/merge').send({
      branch: 'custom-msg-branch',
      message: 'chore: merge custom-msg-branch with custom message',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
