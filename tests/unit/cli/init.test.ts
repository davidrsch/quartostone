// tests/unit/cli/init.test.ts
// Unit tests for src/cli/commands/init.ts
// Uses real temp directories; mocks node:child_process to avoid spawning git.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock child_process before importing init so execSync in init.ts gets the mock.
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { init } from '../../../src/cli/commands/init.js';
import { execSync } from 'node:child_process';

// ── Helpers ───────────────────────────────────────────────────────────────────

let rootTmp: string;

beforeEach(() => {
  rootTmp = mkdtempSync(join(tmpdir(), 'qs-init-test-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(rootTmp, { recursive: true, force: true });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('init() — happy path', () => {
  it('creates _quartostone.yml in the target directory', async () => {
    const dir = join(rootTmp, 'workspace');
    await init('my-ws', { dir });
    expect(existsSync(join(dir, '_quartostone.yml'))).toBe(true);
  });

  it('creates _quarto.yml in the target directory', async () => {
    const dir = join(rootTmp, 'workspace');
    await init('my-ws', { dir });
    expect(existsSync(join(dir, '_quarto.yml'))).toBe(true);
  });

  it('creates pages/index.qmd', async () => {
    const dir = join(rootTmp, 'workspace');
    await init('my-ws', { dir });
    expect(existsSync(join(dir, 'pages', 'index.qmd'))).toBe(true);
  });

  it('creates .gitignore', async () => {
    const dir = join(rootTmp, 'workspace');
    await init('my-ws', { dir });
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
  });

  it('creates the target directory if it does not exist', async () => {
    const nested = join(rootTmp, 'a', 'b', 'c', 'workspace');
    await init('deep', { dir: nested });
    expect(existsSync(nested)).toBe(true);
    expect(existsSync(join(nested, '_quartostone.yml'))).toBe(true);
  });

  it('interpolates workspace name into _quarto.yml', async () => {
    const dir = join(rootTmp, 'ws');
    await init('cool-notes', { dir });
    const content = readFileSync(join(dir, '_quarto.yml'), 'utf-8');
    expect(content).toContain('cool-notes');
  });

  it('interpolates workspace name into pages/index.qmd', async () => {
    const dir = join(rootTmp, 'ws');
    await init('cool-notes', { dir });
    const content = readFileSync(join(dir, 'pages', 'index.qmd'), 'utf-8');
    expect(content).toContain('cool-notes');
  });

  it('does not interpolate {name} literally into _quartostone.yml', async () => {
    const dir = join(rootTmp, 'ws');
    await init('my-project', { dir });
    const content = readFileSync(join(dir, '_quartostone.yml'), 'utf-8');
    // _quartostone.yml has no {name} placeholder
    expect(content).not.toContain('{name}');
    expect(content).not.toContain('my-project');
  });

  it('_quartostone.yml contains expected config keys', async () => {
    const dir = join(rootTmp, 'ws');
    await init('test', { dir });
    const content = readFileSync(join(dir, '_quartostone.yml'), 'utf-8');
    expect(content).toContain('commit_mode:');
    expect(content).toContain('render_on_save:');
    expect(content).toContain('port:');
    expect(content).toContain('watch_interval_ms:');
  });

  it('.gitignore contains _site/ and node_modules/', async () => {
    const dir = join(rootTmp, 'ws');
    await init('test', { dir });
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('_site/');
    expect(content).toContain('node_modules/');
  });
});

// ── Default name ──────────────────────────────────────────────────────────────

describe('init() — default workspace name', () => {
  it('uses "my-quartostone" when name is undefined', async () => {
    const dir = join(rootTmp, 'default-ws');
    await init(undefined, { dir });
    const content = readFileSync(join(dir, '_quarto.yml'), 'utf-8');
    expect(content).toContain('my-quartostone');
  });

  it('pages/index.qmd also uses the default name', async () => {
    const dir = join(rootTmp, 'default-ws');
    await init(undefined, { dir });
    const content = readFileSync(join(dir, 'pages', 'index.qmd'), 'utf-8');
    expect(content).toContain('my-quartostone');
  });
});

// ── Overwrite behaviour ───────────────────────────────────────────────────────

describe('init() — overwrite existing workspace', () => {
  it('overwrites _quarto.yml when workspace already exists', async () => {
    const dir = join(rootTmp, 'overwrite-ws');
    await init('first', { dir });
    await init('second', { dir });

    const content = readFileSync(join(dir, '_quarto.yml'), 'utf-8');
    // Second run should have replaced the first run's name
    expect(content).toContain('second');
    expect(content).not.toContain('first');
  });

  it('overwrites pages/index.qmd on second init', async () => {
    const dir = join(rootTmp, 'overwrite-ws');
    await init('v1', { dir });
    await init('v2', { dir });

    const content = readFileSync(join(dir, 'pages', 'index.qmd'), 'utf-8');
    expect(content).toContain('v2');
    expect(content).not.toContain('v1');
  });
});

// ── Git operations ────────────────────────────────────────────────────────────

describe('init() — git operations', () => {
  it('calls execSync with "git init" in the target directory', async () => {
    const dir = join(rootTmp, 'git-ws');
    await init('test', { dir });

    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      'git init',
      expect.objectContaining({ cwd: dir }),
    );
  });

  it('calls execSync with "git add ." after init', async () => {
    const dir = join(rootTmp, 'git-ws');
    await init('test', { dir });

    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      'git add .',
      expect.objectContaining({ cwd: dir }),
    );
  });

  it('does not throw when git init fails', async () => {
    const dir = join(rootTmp, 'no-git-ws');
    vi.mocked(execSync).mockImplementationOnce(() => { throw new Error('git not found'); });

    await expect(init('test', { dir })).resolves.toBeUndefined();
    // Files should still have been created before git ops
    expect(existsSync(join(dir, '_quartostone.yml'))).toBe(true);
  });

  it('does not throw when git commit fails', async () => {
    const dir = join(rootTmp, 'bad-git-ws');
    // Allow git init and git add, but fail on commit
    vi.mocked(execSync)
      .mockImplementationOnce(() => Buffer.from(''))   // git init
      .mockImplementationOnce(() => Buffer.from(''))   // git add
      .mockImplementationOnce(() => { throw new Error('nothing to commit'); });

    await expect(init('test', { dir })).resolves.toBeUndefined();
    expect(existsSync(join(dir, '_quartostone.yml'))).toBe(true);
  });
});
