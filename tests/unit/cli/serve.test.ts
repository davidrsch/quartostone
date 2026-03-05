// tests/unit/cli/serve.test.ts
// Unit tests for src/cli/commands/serve.ts
//
// Strategy:
//  • process.chdir() to a temp dir so resolve('.') returns a known path.
//  • vi.mock createServer (the real one starts a live HTTP+WebSocket server).
//  • Spy on process.exit so we can assert it is called without killing the process.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Must be declared before imports so vitest hoists them correctly.
vi.mock('../../../src/server/index.js', () => ({
  createServer: vi.fn(),
  createApp: vi.fn(),
}));

import { serve } from '../../../src/cli/commands/serve.js';
import { createServer } from '../../../src/server/index.js';

// ── Setup / teardown ──────────────────────────────────────────────────────────

let tmpDir: string;
let origCwd: string;
let exitSpy: ReturnType<typeof vi.spyOn>;

// Stub server returned by the mocked createServer
const mockListen = vi.fn();
const mockServer = { listen: mockListen };

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), 'qs-serve-test-'));

  // process.exit throws so the serve() promise rejects rather than killing the
  // test runner.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  // Default: createServer resolves with a minimal fake server.
  vi.mocked(createServer).mockResolvedValue({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server: mockServer as any,
    token: 'test-token-abc',
  });

  // listen() calls the callback immediately so serve() completes.
  mockListen.mockImplementation((_port: number, _host: string, cb?: () => void) => {
    cb?.();
  });
});

afterEach(() => {
  // Always restore CWD even if the test threw.
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
  exitSpy.mockRestore();
});

// ── Missing config ────────────────────────────────────────────────────────────

describe('serve() — missing _quartostone.yml', () => {
  it('calls process.exit(1) when _quartostone.yml is not present', async () => {
    process.chdir(tmpDir); // empty dir — no config file

    await expect(serve({ port: undefined, open: false })).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not call createServer when config is missing', async () => {
    process.chdir(tmpDir);

    await expect(serve({ port: undefined, open: false })).rejects.toThrow();
    expect(createServer).not.toHaveBeenCalled();
  });
});

// ── Port resolution ───────────────────────────────────────────────────────────

describe('serve() — port resolution', () => {
  it('uses options.port when explicitly provided', async () => {
    writeFileSync(join(tmpDir, '_quartostone.yml'), 'port: 5555\n');
    process.chdir(tmpDir);

    await serve({ port: 9999, open: false });

    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 9999 }),
    );
  });

  it('falls back to port from config when options.port is undefined', async () => {
    writeFileSync(join(tmpDir, '_quartostone.yml'), 'port: 5555\n');
    process.chdir(tmpDir);

    await serve({ port: undefined, open: false });

    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 5555 }),
    );
  });

  it('uses default port 4242 when neither options nor config specifies one', async () => {
    writeFileSync(join(tmpDir, '_quartostone.yml'), 'commit_mode: prompt\n');
    process.chdir(tmpDir);

    await serve({ port: undefined, open: false });

    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 4242 }),
    );
  });
});

// ── Config forwarding ─────────────────────────────────────────────────────────

describe('serve() — config forwarding', () => {
  it('passes the loaded config object to createServer', async () => {
    writeFileSync(join(tmpDir, '_quartostone.yml'), 'commit_mode: auto\nport: 4242\n');
    process.chdir(tmpDir);

    await serve({ port: undefined, open: false });

    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ commit_mode: 'auto' }),
      }),
    );
  });

  it('passes cwd as the resolved current directory', async () => {
    writeFileSync(join(tmpDir, '_quartostone.yml'), '');
    process.chdir(tmpDir);

    await serve({ port: undefined, open: false });

    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('calls server.listen on the resolved port', async () => {
    writeFileSync(join(tmpDir, '_quartostone.yml'), 'port: 7777\n');
    process.chdir(tmpDir);

    await serve({ port: undefined, open: false });

    expect(mockListen).toHaveBeenCalledWith(
      7777,
      '127.0.0.1',
      expect.any(Function),
    );
  });
});
