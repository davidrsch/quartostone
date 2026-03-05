// tests/unit/server/gitShow.test.ts
// Unit tests for the GET /api/git/show path and SHA validation guards.
//
// The validation in registerGitApi rejects:
//   • SHA that does not match /^[0-9a-f]{4,64}$/i   → 400 "Invalid or missing sha"
//   • missing SHA                                    → 400 "Invalid or missing sha"
//   • path containing ":"                            → 400 "Invalid path"
//   • path starting with "-"                         → 400 "Invalid path"
//   • path that resolves outside the pages directory → 400 "Path outside pages directory"
//
// A path that passes every guard will reach git.show(); since we use a fake
// non-existent SHA the git call returns a "bad object" error that the handler
// translates to 404 — confirming the validation layer was not triggered.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';

// ── Workspace setup ───────────────────────────────────────────────────────────

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

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-gitshow-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  writeFileSync(join(workspace, 'pages', 'test.qmd'), '---\ntitle: Test\n---\n');
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@t.com"', { cwd: workspace });
  execSync('git config user.name "test"', { cwd: workspace });
  execSync('git add .', { cwd: workspace });
  execSync('git commit -m "init"', { cwd: workspace });

  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── SHA validation ─────────────────────────────────────────────────────────────

describe('GET /api/git/show — SHA validation', () => {
  it('returns 400 when sha query param is absent', async () => {
    const res = await client
      .get('/api/git/show')
      .query({ path: 'pages/test.qmd' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sha/i);
  });

  it('returns 400 for a SHA containing non-hex characters', async () => {
    const res = await client
      .get('/api/git/show')
      .query({ sha: 'not-a-valid-sha!!', path: 'pages/test.qmd' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sha/i);
  });

  it('returns 400 for a SHA that is too short (fewer than 4 hex chars)', async () => {
    const res = await client
      .get('/api/git/show')
      .query({ sha: 'ab', path: 'pages/test.qmd' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sha/i);
  });

  it('accepts a 4-character lowercase hex SHA (minimum valid length)', async () => {
    // SHA passes the regex; the git call may fail with 404 — but not 400.
    const res = await client
      .get('/api/git/show')
      .query({ sha: 'abcd', path: 'pages/test.qmd' });

    expect(res.status).not.toBe(400);
  });
});

// ── Path validation guard ──────────────────────────────────────────────────────

describe('GET /api/git/show — path validation', () => {
  // A SHA that satisfies /^[0-9a-f]{4,64}$/i so the SHA check is not triggered.
  const VALID_SHA = 'abcd1234';

  it('returns 400 when path contains a colon', async () => {
    const res = await client
      .get('/api/git/show')
      .query({ sha: VALID_SHA, path: 'pages/foo:bar.qmd' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid path/i);
  });

  it('returns 400 when path starts with a hyphen', async () => {
    const res = await client
      .get('/api/git/show')
      .query({ sha: VALID_SHA, path: '-riskyflag' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid path/i);
  });

  it('returns 400 when path attempts directory traversal outside pages/', async () => {
    const res = await client
      .get('/api/git/show')
      .query({ sha: VALID_SHA, path: '../etc/passwd' });

    // Either "Path outside pages directory" (traversal guard) or "Invalid or missing sha"
    // — either way the server must refuse with 400.
    expect(res.status).toBe(400);
  });

  it('returns 400 when path is missing', async () => {
    const res = await client
      .get('/api/git/show')
      .query({ sha: VALID_SHA });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('does not return 400 for a plain valid path (validation guard not triggered)', async () => {
    // 'pages/test.qmd' has no colon, does not start with '-', and resolves inside
    // the pages directory.  The SHA 'abcd1234' does not exist in the repo so
    // git.show() throws a "bad object" error → the handler returns 404.
    // Any non-400 response confirms the path validation layer was bypassed cleanly.
    const res = await client
      .get('/api/git/show')
      .query({ sha: VALID_SHA, path: 'pages/test.qmd' });

    expect(res.status).not.toBe(400);
  });

  it('resolves the correct status for a valid path at the real HEAD commit', async () => {
    const headSha = execSync('git rev-parse HEAD', { cwd: workspace }).toString().trim();

    const res = await client
      .get('/api/git/show')
      .query({ sha: headSha, path: 'pages/test.qmd' });

    // The file exists at HEAD, so we expect a successful 200 with content.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('content');
    expect(res.body.content).toContain('title: Test');
  });
});
