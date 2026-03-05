// tests/unit/server/spawnCapture.test.ts
// Tests for the spawnCapture utility — mocks node:child_process.spawn so no
// real binaries are required and tests pass on any platform.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock child_process BEFORE importing the module under test ─────────────────
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawn: vi.fn() };
});

const { spawn } = await import('node:child_process');
const spawnMock = vi.mocked(spawn);

import { spawnCapture } from '../../../src/server/utils/spawnCapture.js';

// ── Fake ChildProcess factory ─────────────────────────────────────────────────

interface FakeOpts {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  error?: Error;
  delayMs?: number;
}

function makeProc(opts: FakeOpts = {}) {
  const { stdout = '', stderr = '', exitCode = 0, error, delayMs = 5 } = opts;

  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn>;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => {
    setTimeout(() => proc.emit('close', null), 2);
  });
  proc.stdin = { write: vi.fn(), end: vi.fn() };

  setTimeout(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    if (error) {
      proc.emit('error', error);
    } else {
      proc.emit('close', exitCode);
    }
  }, delayMs);

  return proc;
}

beforeEach(() => { spawnMock.mockReset(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('spawnCapture', () => {
  it('captures stdout and stderr on a successful run', async () => {
    spawnMock.mockReturnValue(makeProc({ stdout: 'hello', stderr: 'warn', exitCode: 0 }) as never);

    const result = await spawnCapture('cmd', ['arg']);
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('warn');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.notFound).toBe(false);
  });

  it('propagates a non-zero exit code', async () => {
    spawnMock.mockReturnValue(makeProc({ exitCode: 1 }) as never);

    const result = await spawnCapture('cmd', []);
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it('sets timedOut=true when the process is killed by the timeout', async () => {
    // Process takes 200 ms — much longer than the 20 ms timeout
    const proc = makeProc({ delayMs: 200, exitCode: 0 });
    proc.kill = vi.fn(() => proc.emit('close', null));
    spawnMock.mockReturnValue(proc as never);

    const result = await spawnCapture('cmd', [], { timeoutMs: 20 });
    expect(result.timedOut).toBe(true);
    expect(proc.kill).toHaveBeenCalled();
  }, 2000);

  it('sets notFound=true on ENOENT spawn error', async () => {
    const proc = makeProc({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) });
    spawnMock.mockReturnValue(proc as never);

    const result = await spawnCapture('nonexistent-binary', []);
    expect(result.notFound).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it('leaves notFound=false for non-ENOENT errors', async () => {
    const proc = makeProc({ error: Object.assign(new Error('EPERM'), { code: 'EPERM' }) });
    spawnMock.mockReturnValue(proc as never);

    const result = await spawnCapture('cmd', []);
    expect(result.notFound).toBe(false);
    expect(result.exitCode).toBeNull();
  });

  it('truncates output once maxOutputBytes is reached', async () => {
    // Send two chunks: first (120 chars) is accepted (0 < 100 → written),
    // second (50 more chars) is dropped because stdout.length >= maxOutputBytes.
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter; stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    proc.stdin = { write: vi.fn(), end: vi.fn() };

    spawnMock.mockReturnValue(proc as never);

    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from('x'.repeat(120)));  // accepted (0 < 100)
      setTimeout(() => {
        proc.stdout.emit('data', Buffer.from('y'.repeat(50))); // dropped (120 >= 100)
        proc.emit('close', 0);
      }, 5);
    }, 5);

    const result = await spawnCapture('cmd', [], { maxOutputBytes: 100 });
    // Second chunk was dropped; only the first chunk is present
    expect(result.stdout).toBe('x'.repeat(120));
    expect(result.stdout).not.toContain('y');
  });

  it('forwards cwd and env options to spawn', async () => {
    spawnMock.mockReturnValue(makeProc() as never);

    await spawnCapture('cmd', [], { cwd: '/tmp', env: { FOO: 'bar' } });
    expect(spawnMock).toHaveBeenCalledWith('cmd', [], expect.objectContaining({
      cwd: '/tmp',
      env: expect.objectContaining({ FOO: 'bar' }),
    }));
  });
});
