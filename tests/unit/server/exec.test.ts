// tests/unit/server/exec.test.ts
// Unit tests for POST /api/exec — mocks node:child_process.spawn so no real
// Python / R / Julia installation is needed.

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
interface FakeProcessOptions {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  emitError?: Error;
  delayMs?: number;
}

function makeFakeProcess(opts: FakeProcessOptions = {}) {
  const { stdout = '', stderr = '', exitCode = 0, emitError, delayMs = 5 } = opts;

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
      // Real Node.js processes emit 'close' after 'error'
      setTimeout(() => {
        proc.emit('close', 1, null);  // exit code 1 on error
      }, delayMs + 10);
    } else {
      proc.emit('close', exitCode);
    }
  }, delayMs);

  // Also emit close after error (some Node versions do both)
  return proc;
}

// ── Test workspace ────────────────────────────────────────────────────────────
const DEFAULT_CONFIG: QuartostoneConfig = {
  commit_mode: 'prompt',
  commit_message_auto: 'qs-{alphanum8}',
  render_on_save: false,
  render_scope: 'file',
  watch_interval_ms: 300,
  port: 0,
  pages_dir: 'pages',
  open_browser: false,
  allow_code_execution: true,
};

let workspace: string;
let client: ReturnType<typeof supertest>;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-exec-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  writeFileSync(join(workspace, 'pages', 'test.qmd'), '---\ntitle: Test\n---\n');
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/exec — validation', () => {
  it('returns 400 when code is missing', async () => {
    const res = await client.post('/api/exec').send({ language: 'python' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/code/i);
  });

  it('returns 400 when code is empty', async () => {
    const res = await client.post('/api/exec').send({ code: '   ', language: 'python' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unsupported language', async () => {
    const res = await client.post('/api/exec').send({ code: 'x = 1', language: 'brainfuck' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported/i);
  });
});

describe('POST /api/exec — python success', () => {
  it('returns stdout from successful Python run', async () => {
    spawnMock.mockImplementationOnce(() => makeFakeProcess({ stdout: 'hello\n', exitCode: 0 }) as never);

    const res = await client.post('/api/exec').send({ code: 'print("hello")', language: 'python' });
    expect(res.status).toBe(200);
    expect(res.body.stdout).toBe('hello\n');
    expect(res.body.ok).toBe(true);
    expect(res.body.exitCode).toBe(0);
    expect(res.body.timedOut).toBe(false);
  });

  it('also matches language "python3"', async () => {
    spawnMock.mockImplementationOnce(() => makeFakeProcess({ stdout: 'ok\n', exitCode: 0 }) as never);

    const res = await client.post('/api/exec').send({ code: 'print("ok")', language: 'python3' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns stderr and ok:false when Python exits non-zero', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ stderr: 'NameError: name foo\n', exitCode: 1 }) as never,
    );

    const res = await client.post('/api/exec').send({ code: 'foo', language: 'python' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.stderr).toContain('NameError');
    expect(res.body.exitCode).toBe(1);
  });
});

describe('POST /api/exec — python fallback to python3', () => {
  it('falls back to python3 when python exits with null (not found)', async () => {
    // First call (python): exit null (command not found — error event)
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ emitError: new Error('spawn python ENOENT') }) as never,
    );
    // Second call (python3): success
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ stdout: 'fallback\n', exitCode: 0 }) as never,
    );

    const res = await client.post('/api/exec').send({ code: 'print("fallback")', language: 'python' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 127 error when both python and python3 are not found', async () => {
    // Both calls produce null exitCode (error on spawn)
    spawnMock
      .mockImplementationOnce(() =>
        makeFakeProcess({ emitError: new Error('spawn python ENOENT') }) as never,
      )
      .mockImplementationOnce(() =>
        makeFakeProcess({ emitError: new Error('spawn python3 ENOENT') }) as never,
      );

    const res = await client.post('/api/exec').send({ code: 'x = 1', language: 'python' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.exitCode).toBe(127);
    expect(res.body.stderr).toMatch(/not found/i);
  });
});

describe('POST /api/exec — R language', () => {
  it('returns stdout from R run', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ stdout: '[1] 42\n', exitCode: 0 }) as never,
    );

    const res = await client.post('/api/exec').send({ code: 'cat(42)', language: 'r' });
    expect(res.status).toBe(200);
    expect(res.body.stdout).toBe('[1] 42\n');
    expect(res.body.ok).toBe(true);
  });

  it('handles R error exit', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ stderr: 'Error: could not find function "foo"\n', exitCode: 1 }) as never,
    );

    const res = await client.post('/api/exec').send({ code: 'foo()', language: 'r' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
});

describe('POST /api/exec — Julia language', () => {
  it('returns stdout from Julia run', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ stdout: 'Hello Julia\n', exitCode: 0 }) as never,
    );

    const res = await client.post('/api/exec').send({ code: 'println("Hello Julia")', language: 'julia' });
    expect(res.status).toBe(200);
    expect(res.body.stdout).toBe('Hello Julia\n');
    expect(res.body.ok).toBe(true);
  });

  it('returns ok:false with null exitCode when julia is not installed (ENOENT)', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFakeProcess({ emitError: new Error('spawn julia ENOENT') }) as never,
    );

    const res = await client.post('/api/exec').send({ code: '1+1', language: 'julia' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.exitCode).toBeNull();
    expect(res.body.stderr).toMatch(/ENOENT/i);
  });
});

describe('POST /api/exec — timeout behavior', () => {
  it('returns timedOut: true when subprocess does not exit within the time limit', async () => {
    // Create a fake process that never emits 'close' on its own;
    // it only emits 'close' when kill() is called (simulating OS SIGKILL).
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn().mockImplementation(() => {
      proc.emit('close', 1);
    });

    // Use 'r' language to avoid a python fallback — exactly one spawn call.
    spawnMock.mockImplementationOnce(() => proc as never);

    // Use a very short timeout (100 ms) via exec_timeout_ms so the test runs quickly
    // without fake timers (which don't play nicely with supertest's real TCP transport).
    const shortTimeoutApp = createApp({
      cwd: workspace,
      config: { ...DEFAULT_CONFIG, exec_timeout_ms: 100 },
      port: 0,
    });
    const res = await supertest(shortTimeoutApp)
      .post('/api/exec')
      .send({ code: 'while(TRUE) {}', language: 'r' });

    expect(res.status).toBe(200);
    expect(res.body.timedOut).toBe(true);
  });

  it('returns 403 when allow_code_execution is false', async () => {
    const restrictedApp = createApp({
      cwd: workspace,
      config: { ...DEFAULT_CONFIG, allow_code_execution: false },
      port: 0,
    });
    const res = await supertest(restrictedApp)
      .post('/api/exec')
      .send({ code: 'x=1', language: 'python' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);
  });
});
