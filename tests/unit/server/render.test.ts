// tests/unit/server/render.test.ts
// Unit tests for POST /api/render — mocks node:child_process.spawn so no
// real Quarto installation is needed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ── Mock child_process BEFORE importing app ───────────────────────────────────
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    spawn: vi.fn(),
  };
});

// Dynamic imports so the mock is hoisted first
const { spawn } = await import('node:child_process');
const spawnMock = vi.mocked(spawn);

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';

// ── Fake ChildProcess factory ─────────────────────────────────────────────────

interface FakeRenderOptions {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  delayMs?: number;
}

function makeFakeProcess(opts: FakeRenderOptions = {}) {
  const { stdout = '', stderr = '', exitCode = 0, delayMs = 5 } = opts;

  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  setTimeout(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  }, delayMs);

  return proc;
}

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

let workspace: string;
let client: ReturnType<typeof supertest>;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-render-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  writeFileSync(join(workspace, 'pages', 'index.qmd'), '---\ntitle: Index\n---\n');
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@test.com"', { cwd: workspace });
  execSync('git config user.name "Test"', { cwd: workspace });
  execSync('git add .', { cwd: workspace });
  execSync('git commit -m "init"', { cwd: workspace });

  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(workspace, { recursive: true, force: true });
});

// ── POST /api/render — validation ─────────────────────────────────────────────

describe('POST /api/render — validation', () => {
  it('returns 400 when scope is invalid', async () => {
    const res = await client.post('/api/render').send({ path: 'index.qmd', scope: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid scope/i);
  });

  it('returns 400 when filePath is missing with scope file', async () => {
    const res = await client.post('/api/render').send({ scope: 'file' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/filePath required/i);
  });

  it('returns 400 when filePath is empty string with scope file', async () => {
    const res = await client.post('/api/render').send({ path: '   ', scope: 'file' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/filePath required/i);
  });

  it('returns 400 when filePath traverses outside pages directory', async () => {
    const res = await client.post('/api/render').send({ path: '../../etc/passwd', scope: 'file' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outside pages/i);
  });
});

// ── POST /api/render — success ────────────────────────────────────────────────

describe('POST /api/render — success', () => {
  it('returns 200 with ok:true on successful render (exit 0)', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ stdout: 'Output processed.\n', exitCode: 0 }) as never,
    );

    const res = await client.post('/api/render').send({ path: 'index.qmd', scope: 'file' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.output).toBe('Output processed.\n');
  });

  it('spawns quarto with the correct arguments for file scope', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ exitCode: 0 }) as never,
    );

    await client.post('/api/render').send({ path: 'index.qmd', scope: 'file' });
    expect(spawnMock).toHaveBeenCalledOnce();
    const [cmd, args] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe('quarto');
    expect(args![0]).toBe('render');
    // Second arg is the absolute path resolved inside pagesDir
    expect(String(args![1])).toMatch(/index\.qmd$/);
  });

  it('renders the project root when scope is project', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ exitCode: 0 }) as never,
    );

    const res = await client.post('/api/render').send({ scope: 'project' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // The render target should be the workspace cwd (not a specific .qmd file)
    const [, args] = spawnMock.mock.calls[0]!;
    expect(String(args![1])).not.toMatch(/\.qmd$/);
  });
});

// ── POST /api/render — failure ────────────────────────────────────────────────

describe('POST /api/render — failure', () => {
  it('returns 500 with ok:false when quarto exits non-zero', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ stderr: 'ERROR: render failed\n', exitCode: 1 }) as never,
    );

    const res = await client.post('/api/render').send({ path: 'index.qmd', scope: 'file' });
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('ERROR: render failed');
  });

  it('returns 500 with a descriptive message when quarto exits with a non-zero code and no stderr', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ exitCode: 2 }) as never,
    );

    const res = await client.post('/api/render').send({ path: 'index.qmd', scope: 'file' });
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/exited with code/i);
  });
});
