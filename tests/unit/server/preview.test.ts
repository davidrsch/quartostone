// tests/unit/server/preview.test.ts
// Unit tests for the preview API endpoints.
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
import { previews } from '../../../src/server/api/preview.js';

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
};

let workspace: string;
let client: ReturnType<typeof supertest>;

beforeEach(() => {
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
  it('returns 400 when path is missing', async () => {
    const res = await client.post('/api/preview/stop').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
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
  it('returns 400 when path is missing', async () => {
    const res = await client.get('/api/preview/status');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
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
