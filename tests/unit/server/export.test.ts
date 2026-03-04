// tests/unit/server/export.test.ts
// Unit tests for the export API endpoints.
// Mocks node:child_process.spawn so no real Quarto installation is needed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import supertest from 'supertest';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ── Mock child_process BEFORE importing app ───────────────────────────────────
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawn: vi.fn() };
});

const { spawn } = await import('node:child_process');
const spawnMock = vi.mocked(spawn);

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';

// ── Fake ChildProcess factory ─────────────────────────────────────────────────

interface FakeProcessOptions {
  stdout?:    string;
  stderr?:    string;
  exitCode?:  number | null;
  emitError?: Error;
  delayMs?:   number;
  /** If provided, writes this content to the given path on 'close' */
  writeOutputFile?: string;
}

function makeFakeProcess(opts: FakeProcessOptions = {}) {
  const {
    stdout = '', stderr = '', exitCode = 0,
    emitError, delayMs = 5, writeOutputFile,
  } = opts;

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
    if (emitError) {
      proc.emit('error', emitError);
    } else {
      if (writeOutputFile) {
        try { writeFileSync(writeOutputFile, '<html>hello</html>'); } catch { /* ignore */ }
      }
      proc.emit('close', exitCode);
    }
  }, delayMs);

  return proc;
}

// ── Sleep helper ──────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

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

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-export-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  writeFileSync(join(workspace, 'pages', 'doc.qmd'), '---\ntitle: Doc\n---\n\nHello\n');
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

// ── POST /api/export — validation ─────────────────────────────────────────────

describe('POST /api/export — validation', () => {
  it('returns 400 when path is missing', async () => {
    const res = await client.post('/api/export').send({ format: 'html' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('returns 400 when format is missing', async () => {
    const res = await client.post('/api/export').send({ path: 'pages/doc.qmd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/format/i);
  });

  it('returns 404 when file does not exist', async () => {
    const res = await client
      .post('/api/export')
      .send({ path: 'pages/missing.qmd', format: 'html' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when extraArgs is not an array', async () => {
    const res = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'html', extraArgs: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/extraArgs/i);
  });
});

// ── POST /api/export — blocked extraArgs ────────────────────────────────────────

describe('POST /api/export — blocked extraArgs', () => {
  it('returns 400 when extraArgs contains a blocked argument', async () => {
    const res = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'html', extraArgs: ['--lua-filter=evil.lua'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/blocked|unsafe/i);
  });

  it('returns 400 when extraArgs contains a path-traversal template arg', async () => {
    const res = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'html', extraArgs: ['--template=../../../etc/passwd'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/blocked|unsafe/i);
  });
});

// ── POST /api/export — success ────────────────────────────────────────────────

describe('POST /api/export — success', () => {
  it('returns a token with status pending immediately', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ exitCode: 0 }) as never
    );

    const res = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'html' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'pending' });
    expect(typeof res.body.token).toBe('string');
  });

  it('transitions to done after quarto exits successfully', async () => {
    // We need the fake process to also write the expected output file,
    // but we don't know its tmp path ahead of time.
    // Instead we test that the job becomes 'done' by using a spy that
    // writes to the outFile argument passed to spawn.

    let capturedOutFile = '';
    spawnMock.mockImplementationOnce((_cmd: string, args: readonly string[]) => {
      // --output <outFile> is in the args list
      const outIdx = args.indexOf('--output');
      if (outIdx >= 0) { capturedOutFile = args[outIdx + 1] as string; }
      return makeFakeProcess({
        exitCode: 0,
        writeOutputFile: capturedOutFile,
      }) as never;
    });

    const postRes = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'html' });

    expect(postRes.status).toBe(200);
    const { token } = postRes.body as { token: string };

    // Poll until done (or timeout)
    let job: { status: string; filename?: string } = { status: 'pending' };
    for (let i = 0; i < 20; i++) {
      await sleep(30);
      const statusRes = await client.get(`/api/export/status?token=${token}`);
      job = statusRes.body as typeof job;
      if (job.status !== 'pending' && job.status !== 'running') break;
    }

    expect(job.status).toBe('done');
    expect(job.filename).toMatch(/\.html$/);
  });
});

// ── GET /api/export/status ────────────────────────────────────────────────────

describe('GET /api/export/status', () => {
  it('returns 400 when token is missing', async () => {
    const res = await client.get('/api/export/status');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it('returns 404 for unknown token', async () => {
    const res = await client.get('/api/export/status?token=does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns pending status right after POST', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ exitCode: 0, delayMs: 200 }) as never
    );

    const postRes = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'html' });
    const { token } = postRes.body as { token: string };

    const statusRes = await client.get(`/api/export/status?token=${token}`);
    // status could be pending or running depending on timing
    expect(['pending', 'running']).toContain(statusRes.body.status);
  });
});

// ── GET /api/export/download ──────────────────────────────────────────────────

describe('GET /api/export/download', () => {
  it('returns 400 when token is missing', async () => {
    const res = await client.get('/api/export/download');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown token', async () => {
    const res = await client.get('/api/export/download?token=no-such-token');
    expect(res.status).toBe(404);
  });

  it('returns 409 if job is still pending', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ exitCode: 0, delayMs: 300 }) as never
    );

    const postRes = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'html' });
    const { token } = postRes.body as { token: string };

    // Download immediately — job is still pending/running
    const dlRes = await client.get(`/api/export/download?token=${token}`);
    expect(dlRes.status).toBe(409);
    expect(dlRes.body.error).toMatch(/not complete/i);
  });

  it('streams the file and removes job on download', async () => {
    let capturedOutFile = '';
    spawnMock.mockImplementationOnce((_cmd: string, args: readonly string[]) => {
      const outIdx = args.indexOf('--output');
      if (outIdx >= 0) { capturedOutFile = args[outIdx + 1] as string; }
      return makeFakeProcess({
        exitCode: 0,
        writeOutputFile: capturedOutFile,
        delayMs: 10,
      }) as never;
    });

    const postRes = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'html' });
    const { token } = postRes.body as { token: string };

    // Wait for completion
    for (let i = 0; i < 30; i++) {
      await sleep(30);
      const s = await client.get(`/api/export/status?token=${token}`);
      if ((s.body as { status: string }).status === 'done') break;
    }

    const dlRes = await client.get(`/api/export/download?token=${token}`);
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers['content-disposition']).toMatch(/attachment/);

    // After download, job is gone — subsequent status should 404
    await sleep(20);
    const statusAfter = await client.get(`/api/export/status?token=${token}`);
    expect(statusAfter.status).toBe(404);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('POST /api/export — quarto errors', () => {
  it('reports Quarto not installed (ENOENT)', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ emitError: Object.assign(new Error('spawn quarto ENOENT'), { code: 'ENOENT' }) }) as never
    );

    const postRes = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'html' });
    const { token } = postRes.body as { token: string };

    for (let i = 0; i < 20; i++) {
      await sleep(30);
      const s = await client.get(`/api/export/status?token=${token}`);
      if ((s.body as { status: string }).status === 'error') {
        expect((s.body as { error: string }).error).toMatch(/not installed/i);
        return;
      }
    }
    throw new Error('Expected job to enter error state');
  });

  it('reports LaTeX not installed when stderr mentions LaTeX', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ stderr: 'ERROR: LaTeX failed. pdflatex not found.', exitCode: 1 }) as never
    );

    const postRes = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'pdf' });
    const { token } = postRes.body as { token: string };

    for (let i = 0; i < 20; i++) {
      await sleep(30);
      const s = await client.get(`/api/export/status?token=${token}`);
      if ((s.body as { status: string }).status === 'error') {
        expect((s.body as { error: string }).error).toMatch(/LaTeX/i);
        return;
      }
    }
    throw new Error('Expected job to enter error state');
  });

  it('reports typst not installed when stderr mentions typst not found', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ stderr: 'typst not found in PATH', exitCode: 1 }) as never
    );

    const postRes = await client
      .post('/api/export')
      .send({ path: 'pages/doc.qmd', format: 'typst' });
    const { token } = postRes.body as { token: string };

    for (let i = 0; i < 20; i++) {
      await sleep(30);
      const s = await client.get(`/api/export/status?token=${token}`);
      if ((s.body as { status: string }).status === 'error') {
        expect((s.body as { error: string }).error).toMatch(/typst/i);
        return;
      }
    }
    throw new Error('Expected job to enter error state');
  });
});
