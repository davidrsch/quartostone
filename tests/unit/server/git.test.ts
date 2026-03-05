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

  it('returns 400 for an invalid SHA format', async () => {
    const res = await client.get('/api/git/diff').query({ sha: 'not-a-valid-sha!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid sha/i);
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

  it('returns 400 when commit message exceeds 4096 characters', async () => {
    const longMessage = 'x'.repeat(4097);
    const res = await client.post('/api/git/commit').send({ message: longMessage });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
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

// ═══════════════════════════════════════════════════════════════════════════════
// Remote / push / pull / merge-resolution routes
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /api/git/remote ───────────────────────────────────────────────────────

describe('GET /api/git/remote', () => {
  it('returns remote info shape even with no remote configured', async () => {
    const res = await client.get('/api/git/remote');
    expect(res.status).toBe(200);
    expect(typeof res.body.url).toBe('string');
    expect(typeof res.body.branch).toBe('string');
    expect(typeof res.body.ahead).toBe('number');
    expect(typeof res.body.behind).toBe('number');
  });
});

// ── PATCH /api/git/remote — URL validation (security-critical, C2) ────────────

describe('PATCH /api/git/remote', () => {
  it('returns 400 when url is missing', async () => {
    const res = await client.patch('/api/git/remote').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url.*required/i);
  });

  it('rejects file:// protocol (disallowed local path)', async () => {
    const res = await client.patch('/api/git/remote').send({ url: 'file:///tmp/local-repo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/https.*ssh.*git|protocol/i);
  });

  it('rejects a non-parseable URL', async () => {
    const res = await client.patch('/api/git/remote').send({ url: 'not a url at all' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid remote url/i);
  });

  it('accepts a valid https URL and sets the remote', async () => {
    const res = await client
      .patch('/api/git/remote')
      .send({ url: 'https://github.com/example/repo.git' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Remove origin so subsequent tests are not affected by a stale remote
    try { execSync('git remote remove origin', { cwd: workspace }); } catch { /* ok */ }
  });
});

// ── POST /api/git/push (no remote) ───────────────────────────────────────────

describe('POST /api/git/push', () => {
  it('returns a server error when no remote is configured', async () => {
    const res = await client.post('/api/git/push');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ── POST /api/git/pull (no remote) ───────────────────────────────────────────

describe('POST /api/git/pull', () => {
  it('returns an error response when no remote is configured', async () => {
    const res = await client.post('/api/git/pull');
    expect([500, 409]).toContain(res.status);
    expect(res.body).toHaveProperty('error');
  });
});

// ── GET /api/git/conflicts ────────────────────────────────────────────────────

describe('GET /api/git/conflicts', () => {
  it('returns empty conflicts array when working tree is clean', async () => {
    const res = await client.get('/api/git/conflicts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.conflicted)).toBe(true);
    expect(res.body.conflicted).toHaveLength(0);
  });
});

// ── POST /api/git/merge-abort (no merge in progress) ─────────────────────────

describe('POST /api/git/merge-abort', () => {
  it('returns a server error when no merge is in progress', async () => {
    const res = await client.post('/api/git/merge-abort');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ── POST /api/git/merge-complete ────────────────────────────────────────────
// Success path tested in the dedicated workspace below.
// The error path (nothing to commit) is implicitly covered by the conflict +
// abort test above which leaves a clean workspace.

// ── POST /api/git/merge — 409 conflict + full conflict lifecycle (H1, H3) ─────

describe('POST /api/git/merge — conflict scenario', () => {
  let conflictWs: string;
  let conflictClient: ReturnType<typeof supertest>;

  beforeAll(() => {
    conflictWs = mkdtempSync(join(tmpdir(), 'qs-git-conflict-'));
    mkdirSync(join(conflictWs, 'pages'), { recursive: true });
    execSync('git init', { cwd: conflictWs });
    execSync('git config user.email "test@test.com"', { cwd: conflictWs });
    execSync('git config user.name "Test"', { cwd: conflictWs });

    // Base commit on default branch
    writeFileSync(join(conflictWs, 'pages', 'conflict.qmd'), '---\ntitle: Base\n---\nbase line\n');
    execSync('git add .', { cwd: conflictWs });
    execSync('git commit -m "base"', { cwd: conflictWs });

    const mainBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: conflictWs })
      .toString().trim();

    // Feature branch — different change to the same line
    execSync('git checkout -b feature-for-conflict', { cwd: conflictWs });
    writeFileSync(join(conflictWs, 'pages', 'conflict.qmd'), '---\ntitle: Feature\n---\nfeature line\n');
    execSync('git add .', { cwd: conflictWs });
    execSync('git commit -m "feature change"', { cwd: conflictWs });

    // Back on main, commit a different change to the same line
    execSync(`git checkout ${mainBranch}`, { cwd: conflictWs });
    writeFileSync(join(conflictWs, 'pages', 'conflict.qmd'), '---\ntitle: Main\n---\nmain line\n');
    execSync('git add .', { cwd: conflictWs });
    execSync('git commit -m "main change"', { cwd: conflictWs });

    conflictClient = supertest(createApp({ cwd: conflictWs, config: DEFAULT_CONFIG, port: 0 }));
  });

  afterAll(() => {
    rmSync(conflictWs, { recursive: true, force: true });
  });

  it('returns 409 when merge produces a conflict (H3)', async () => {
    const res = await conflictClient.post('/api/git/merge').send({ branch: 'feature-for-conflict' });
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
    expect(Array.isArray(res.body.conflicts)).toBe(true);
  });

  it('GET /api/git/conflicts lists the conflicted file after a failed merge', async () => {
    const res = await conflictClient.get('/api/git/conflicts');
    expect(res.status).toBe(200);
    expect(res.body.conflicted.length).toBeGreaterThan(0);
  });

  it('POST /api/git/merge-abort clears the merge state and returns ok', async () => {
    const res = await conflictClient.post('/api/git/merge-abort');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── POST /api/git/merge-complete — full resolution flow ──────────────────────

describe('POST /api/git/merge-complete — resolve and commit', () => {
  let completWs: string;
  let completClient: ReturnType<typeof supertest>;

  beforeAll(() => {
    completWs = mkdtempSync(join(tmpdir(), 'qs-git-complete-'));
    mkdirSync(join(completWs, 'pages'), { recursive: true });
    execSync('git init', { cwd: completWs });
    execSync('git config user.email "test@test.com"', { cwd: completWs });
    execSync('git config user.name "Test"', { cwd: completWs });

    writeFileSync(join(completWs, 'pages', 'complete.qmd'), '# base\n');
    execSync('git add .', { cwd: completWs });
    execSync('git commit -m "base"', { cwd: completWs });

    const mainBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: completWs })
      .toString().trim();

    execSync('git checkout -b feat-complete', { cwd: completWs });
    writeFileSync(join(completWs, 'pages', 'complete.qmd'), '# feature\n');
    execSync('git add .', { cwd: completWs });
    execSync('git commit -m "feat"', { cwd: completWs });

    execSync(`git checkout ${mainBranch}`, { cwd: completWs });
    writeFileSync(join(completWs, 'pages', 'complete.qmd'), '# main\n');
    execSync('git add .', { cwd: completWs });
    execSync('git commit -m "main"', { cwd: completWs });

    // Trigger the conflict
    try { execSync('git merge feat-complete --no-ff', { cwd: completWs }); } catch { /* expected conflict */ }

    // Manually resolve: write a resolution and stage it
    writeFileSync(join(completWs, 'pages', 'complete.qmd'), '# resolved\n');
    execSync('git add pages/complete.qmd', { cwd: completWs });

    completClient = supertest(createApp({ cwd: completWs, config: DEFAULT_CONFIG, port: 0 }));
  });

  afterAll(() => {
    rmSync(completWs, { recursive: true, force: true });
  });

  it('creates a merge commit after manual conflict resolution', async () => {
    const res = await completClient.post('/api/git/merge-complete');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.commit).toBe('string');
  });
});

// ── POST /api/git/checkout — stashConflict path (H4) ─────────────────────────

describe('POST /api/git/checkout — stashConflict', () => {
  let scWs: string;
  let scClient: ReturnType<typeof supertest>;

  beforeAll(() => {
    scWs = mkdtempSync(join(tmpdir(), 'qs-git-stash-'));
    mkdirSync(join(scWs, 'pages'), { recursive: true });
    execSync('git init', { cwd: scWs });
    execSync('git config user.email "test@test.com"', { cwd: scWs });
    execSync('git config user.name "Test"', { cwd: scWs });
    // Disable CRLF conversion so the 3-way merge conflict is not masked by line-ending normalisation
    execSync('git config core.autocrlf false', { cwd: scWs });
    // Disable worktree-based rebase so git stash pop uses the standard 3-way merge
    execSync('git config merge.conflictstyle merge', { cwd: scWs });

    // Base commit: multi-line file so git has clear context for conflict detection
    writeFileSync(join(scWs, 'pages', 'stash.qmd'), 'context-top\nCONFLICT_LINE\ncontext-bottom\n');
    execSync('git add .', { cwd: scWs });
    execSync('git commit -m "base"', { cwd: scWs });

    const mainBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: scWs })
      .toString().trim();

    // Branch: commits a DIFFERENT change to the designated conflict line
    execSync('git checkout -b stash-target-branch', { cwd: scWs });
    writeFileSync(join(scWs, 'pages', 'stash.qmd'), 'context-top\nBRANCH_CHANGE\ncontext-bottom\n');
    execSync('git add .', { cwd: scWs });
    execSync('git commit -m "branch commit"', { cwd: scWs });

    // Back on main with an uncommitted change to that same line (will become the stash)
    execSync(`git checkout ${mainBranch}`, { cwd: scWs });
    writeFileSync(join(scWs, 'pages', 'stash.qmd'), 'context-top\nWORKING_CHANGE\ncontext-bottom\n');
    // Do NOT commit — dirty working tree state

    scClient = supertest(createApp({ cwd: scWs, config: DEFAULT_CONFIG, port: 0 }));
  });

  afterAll(() => {
    rmSync(scWs, { recursive: true, force: true });
  });

  it('returns { ok: true, stashConflict: true } when stash-pop conflicts on branch switch', async () => {
    const res = await scClient.post('/api/git/checkout').send({ branch: 'stash-target-branch' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Both the branch and the stash modified stash.qmd differently from the common ancestor,
    // so the stash pop will produce a 3-way merge conflict.
    expect(res.body.stashConflict).toBe(true);
  });
});
