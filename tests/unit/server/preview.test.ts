// tests/unit/server/preview.test.ts
// Unit tests for the preview API endpoints.
// Mocks node:child_process.spawn AND execSync so no real Quarto installation
// is needed (resolveQuartoPath is bypassed with a fake path that exists).

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
// We mock both spawn (used by the preview runner) and execSync (used by
// resolveQuartoPath to locate the quarto binary).  When execSync is called
// with a quarto-detection command we return a path that actually exists on
// disk so that existsSync(path) === true and quartoExecutable is non-null,
// thereby bypassing the 503 "quarto not installed" guard in the route handler.
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();

  // A fake quarto binary path that exists on every platform so that
  // existsSync(fakePath) returns true inside resolveQuartoPath().
  const fakePath = process.platform === 'win32'
    ? 'C:\\Windows\\System32\\cmd.exe'
    : '/usr/bin/env';

  const mockedExecSync = (cmd: string, opts?: unknown): Buffer | string => {
    // Intercept quarto PATH-detection commands
    if (typeof cmd === 'string' &&
        (cmd.startsWith('which ') || cmd.startsWith('where ')) &&
        cmd.includes('quarto')) {
      return fakePath;
    }
    // Everything else (git init, git config …) — call through to the real impl
    return (original.execSync as (c: string, o?: unknown) => Buffer)(cmd, opts);
  };

  return { ...original, spawn: vi.fn(), execSync: mockedExecSync };
});

const { spawn } = await import('node:child_process');
const spawnMock = vi.mocked(spawn);

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';
import { previews, setQuartoExeForTest } from '../../../src/server/api/preview.js';

/** Platform-appropriate existing binary used as a stand-in for quarto in tests. */
const FAKE_QUARTO_PATH = process.platform === 'win32'
  ? 'C:\\Windows\\System32\\cmd.exe'
  : '/usr/bin/env';

// ── Fake ChildProcess factory ─────────────────────────────────────────────────

function makeLongRunningProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => {
    // Simulate process exit after kill
    setTimeout(() => proc.emit('exit', null), 10);
  });
  // Process runs indefinitely until kill() is called
  return proc;
}

function makeEarlyExitProcess(delayMs = 20) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  setTimeout(() => proc.emit('exit', 1), delayMs);
  return proc;
}

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
  // Preset the cached quarto executable so resolveQuartoPath() is never called
  // (avoids spawning a real `where`/`which` process and consuming spawn mocks).
  setQuartoExeForTest(FAKE_QUARTO_PATH);

  workspace = mkdtempSync(join(tmpdir(), 'qs-preview-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  writeFileSync(join(workspace, 'pages', 'slide.qmd'), '---\ntitle: Slide\n---\n\nHello\n');
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@test.com"', { cwd: workspace });
  execSync('git config user.name "Test"', { cwd: workspace });
  execSync('git add .', { cwd: workspace });
  execSync('git commit -m "init"', { cwd: workspace });

  // Clear the previews map before each test
  previews.clear();

  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterEach(() => {
  vi.clearAllMocks();
  previews.clear();
  // Reset the quarto exe cache so the next test starts fresh.
  setQuartoExeForTest(undefined);
  rmSync(workspace, { recursive: true, force: true });
});

// ── POST /api/preview/start — validation ──────────────────────────────────────

describe('POST /api/preview/start — validation', () => {
  it('returns 400 when path is missing', async () => {
    const res = await client.post('/api/preview/start').send({ format: 'html' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('returns 404 when file does not exist', async () => {
    const res = await client
      .post('/api/preview/start')
      .send({ path: 'pages/ghost.qmd', format: 'html' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ── POST /api/preview/start — success ────────────────────────────────────────

describe('POST /api/preview/start — success', () => {
  it('starts a new preview and returns port and url', async () => {
    spawnMock.mockImplementationOnce(() => makeLongRunningProcess() as never);

    const res = await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'html' });

    expect(res.status).toBe(200);
    expect(typeof res.body.port).toBe('number');
    expect(res.body.url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(res.body.reused).toBe(false);
  });

  it('reuses existing preview when same path and format', async () => {
    spawnMock.mockImplementationOnce(() => makeLongRunningProcess() as never);

    // First request
    const res1 = await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'html' });
    expect(res1.status).toBe(200);

    // Second request — same file + format
    const res2 = await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'html' });

    expect(res2.status).toBe(200);
    expect(res2.body.reused).toBe(true);
    expect(res2.body.port).toBe(res1.body.port);
    // spawn should only have been called once
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('restarts preview when format changes', async () => {
    // First preview: html
    spawnMock.mockImplementationOnce(() => makeLongRunningProcess() as never);
    const res1 = await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'html' });
    expect(res1.body.reused).toBe(false);

    // Second preview: revealjs — should kill old and spawn new
    spawnMock.mockImplementationOnce(() => makeLongRunningProcess() as never);
    const res2 = await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'revealjs' });
    expect(res2.status).toBe(200);
    expect(res2.body.reused).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('uses html as default format when format is omitted', async () => {
    spawnMock.mockImplementationOnce(() => makeLongRunningProcess() as never);

    const res = await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd' }); // no format

    expect(res.status).toBe(200);
    expect(res.body.reused).toBe(false);

    // Check registry
    const entry = previews.get('pages/slide.qmd');
    expect(entry?.format).toBe('html');
  });
});

// ── POST /api/preview/stop ────────────────────────────────────────────────────

describe('POST /api/preview/stop', () => {
  it('returns ok with stopped:0 when path is omitted (stops all; none running)', async () => {
    const res = await client.post('/api/preview/stop').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.stopped).toBe(0);
  });

  it('returns wasRunning: false when no preview is running for that path', async () => {
    const res = await client
      .post('/api/preview/stop')
      .send({ path: 'pages/slide.qmd' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.wasRunning).toBe(false);
  });

  it('stops a running preview and returns wasRunning: true', async () => {
    const fakeProc = makeLongRunningProcess();
    spawnMock.mockImplementationOnce(() => fakeProc as never);

    await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'html' });

    const stopRes = await client
      .post('/api/preview/stop')
      .send({ path: 'pages/slide.qmd' });

    expect(stopRes.status).toBe(200);
    expect(stopRes.body.ok).toBe(true);
    expect(stopRes.body.wasRunning).toBe(true);
    expect(fakeProc.kill).toHaveBeenCalled();
    expect(previews.has('pages/slide.qmd')).toBe(false);
  });
});

// ── GET /api/preview/status ───────────────────────────────────────────────────

describe('GET /api/preview/status', () => {
  it('returns global running:false when path is omitted and no previews active', async () => {
    const res = await client.get('/api/preview/status');
    expect(res.status).toBe(200);
    expect(res.body.running).toBe(false);
    expect(res.body.count).toBe(0);
  });

  it('returns running: false when no preview exists', async () => {
    const res = await client.get('/api/preview/status?path=pages/slide.qmd');
    expect(res.status).toBe(200);
    expect(res.body.running).toBe(false);
  });

  it('returns running: true with url and port for active preview', async () => {
    spawnMock.mockImplementationOnce(() => makeLongRunningProcess() as never);

    await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'html' });

    const statusRes = await client.get('/api/preview/status?path=pages/slide.qmd');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.running).toBe(true);
    expect(typeof statusRes.body.port).toBe('number');
    expect(statusRes.body.url).toMatch(/localhost/);
    expect(statusRes.body.format).toBe('html');
  });

  it('returns running: false after the process exits', async () => {
    spawnMock.mockImplementationOnce(() => makeEarlyExitProcess(30) as never);

    await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'html' });

    // Wait for process to auto-exit
    await new Promise(r => setTimeout(r, 80));

    const statusRes = await client.get('/api/preview/status?path=pages/slide.qmd');
    expect(statusRes.body.running).toBe(false);
  });

  it('removes preview from registry when process emits error', async () => {
    // proc that emits 'error' after a short delay
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    spawnMock.mockImplementationOnce(() => proc as never);

    await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'html' });

    // Preview should be running
    const before = await client.get('/api/preview/status?path=pages/slide.qmd');
    expect(before.body.running).toBe(true);

    // Emit error event — mimics spawn ENOENT / quarto crash
    proc.emit('error', new Error('ENOENT'));
    await new Promise(r => setTimeout(r, 20));

    // Preview should be removed from registry
    const after = await client.get('/api/preview/status?path=pages/slide.qmd');
    expect(after.body.running).toBe(false);
  });
});

// ── GET /api/preview/status — quartoAvailable field (#118) ───────────────────

describe('GET /api/preview/status — quartoAvailable field', () => {
  it('includes quartoAvailable boolean in global status response', async () => {
    const res = await client.get('/api/preview/status');
    expect(res.status).toBe(200);
    expect(typeof res.body.quartoAvailable).toBe('boolean');
  });
});

// ── GET /api/preview/logs (#118) ─────────────────────────────────────────────

describe('GET /api/preview/logs', () => {
  it('returns 400 when path query param is missing', async () => {
    const res = await client.get('/api/preview/logs');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('returns empty logs array when no preview is running for that path', async () => {
    const res = await client.get('/api/preview/logs?path=pages/slide.qmd');
    expect(res.status).toBe(200);
    expect(res.body.logs).toEqual([]);
  });

  it('returns captured stdout/stderr lines after process emits data', async () => {
    // Build a process that emits known log lines via stdout
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    spawnMock.mockImplementationOnce(() => proc as never);

    await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'html' });

    // Emit some log data from stdout and stderr
    proc.stdout.emit('data', Buffer.from('Preparing to render...\n'));
    proc.stderr.emit('data', Buffer.from('Quarto 1.5.0 ready\n'));

    // Brief settle — logs are captured synchronously in the data handler
    await new Promise(r => setTimeout(r, 20));

    const res = await client.get('/api/preview/logs?path=pages/slide.qmd');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs).toContain('Preparing to render...');
    expect(res.body.logs).toContain('Quarto 1.5.0 ready');
  });

  it('caps logs at 200 entries and discards oldest', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    spawnMock.mockImplementationOnce(() => proc as never);

    await client
      .post('/api/preview/start')
      .send({ path: 'pages/slide.qmd', format: 'html' });

    // Emit 250 lines
    for (let i = 0; i < 250; i++) {
      proc.stdout.emit('data', Buffer.from(`line-${i}\n`));
    }
    await new Promise(r => setTimeout(r, 20));

    const res = await client.get('/api/preview/logs?path=pages/slide.qmd');
    expect(res.body.logs.length).toBeLessThanOrEqual(200);
    // Most recent lines should be present; oldest dropped
    expect(res.body.logs).toContain('line-249');
  });
});

// ── GET /api/preview/ready (#118) ────────────────────────────────────────────

describe('GET /api/preview/ready', () => {
  it('returns 400 when port param is missing', async () => {
    const res = await client.get('/api/preview/ready');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/port/i);
  });

  it('returns 400 (SSRF guard) when port is not registered in an active preview session', async () => {
    // Port 9999 is not registered in previews — SSRF guard must reject it
    const res = await client.get('/api/preview/ready?port=9999&timeout=400');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No active preview session/i);
  });

  it('returns { ready: false, timedOut: true } when registered port has no TCP listener', async () => {
    // Register a fake session so the SSRF guard passes; nothing listens on port 1
    previews.set('test/fixture.qmd', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      proc: { kill: vi.fn() } as any,
      port: 1,
      url: 'http://localhost:1',
      path: 'test/fixture.qmd',
      format: 'html',
      logs: [],
    });

    // Use a very short timeout so the test finishes quickly
    const res = await client.get('/api/preview/ready?port=1&timeout=400');
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(false);
    expect(res.body.timedOut).toBe(true);
  }, 5000);
});
