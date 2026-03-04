// tests/unit/server/config.test.ts
// Unit tests for src/server/config.ts
// Tests config loading (file missing → defaults, partial YAML → merged) and slug generation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, generateCommitSlug } from '../../../src/server/config.js';

// ── loadConfig ────────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `qs-config-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, '_quartostone.yml');
  });

  afterEach(() => {
    try { unlinkSync(configPath); } catch { /* already gone */ }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns defaults when the config file does not exist', async () => {
    const config = await loadConfig(join(tmpDir, 'nonexistent.yml'));

    expect(config.commit_mode).toBe('prompt');
    expect(config.port).toBe(4242);
    expect(config.pages_dir).toBe('pages');
    expect(config.render_on_save).toBe(true);
    expect(config.open_browser).toBe(true);
  });

  it('merges a partial YAML config with defaults', async () => {
    writeFileSync(configPath, 'port: 5000\ncommit_mode: auto\n');

    const config = await loadConfig(configPath);

    expect(config.port).toBe(5000);
    expect(config.commit_mode).toBe('auto');
    // Unspecified fields should still be defaults
    expect(config.pages_dir).toBe('pages');
    expect(config.render_on_save).toBe(true);
  });

  it('reads a full config file without overriding unset values to undefined', async () => {
    writeFileSync(
      configPath,
      [
        'commit_mode: manual',
        'render_on_save: false',
        'port: 9090',
        'pages_dir: notes',
        'open_browser: false',
      ].join('\n'),
    );

    const config = await loadConfig(configPath);

    expect(config.commit_mode).toBe('manual');
    expect(config.render_on_save).toBe(false);
    expect(config.port).toBe(9090);
    expect(config.pages_dir).toBe('notes');
    expect(config.open_browser).toBe(false);
    // Default fields not overridden in YAML should be preserved
    expect(config.watch_interval_ms).toBe(300);
  });

  it('returns defaults on an empty (zero-byte) config file', async () => {
    writeFileSync(configPath, '');

    const config = await loadConfig(configPath);

    expect(config.port).toBe(4242);
    expect(config.commit_mode).toBe('prompt');
  });

  it('falls back to default commit_mode when given an unrecognised value', async () => {
    writeFileSync(configPath, 'commit_mode: magic\n');

    const config = await loadConfig(configPath);

    expect(config.commit_mode).toBe('prompt'); // the default
  });

  it('falls back to default port when given a non-numeric port value', async () => {
    writeFileSync(configPath, 'port: not-a-number\n');

    const config = await loadConfig(configPath);

    expect(config.port).toBe(4242); // the default
  });

  it('resets watch_interval_ms to 300 when given 0', async () => {
    writeFileSync(configPath, 'watch_interval_ms: 0\n');

    const config = await loadConfig(configPath);

    expect(config.watch_interval_ms).toBe(300); // the default
  });
});

// ── generateCommitSlug ────────────────────────────────────────────────────────

describe('generateCommitSlug', () => {
  it('replaces {alphanum8} with exactly 8 alphanumeric characters', () => {
    const slug = generateCommitSlug('qs-{alphanum8}');

    expect(slug).toMatch(/^qs-[a-z0-9]{8}$/);
  });

  it('keeps the rest of the pattern intact', () => {
    const slug = generateCommitSlug('auto-save [{alphanum8}]');

    expect(slug).toMatch(/^auto-save \[[a-z0-9]{8}\]$/);
  });

  it('produces different slugs on consecutive calls (entropy check)', () => {
    const slugs = new Set(Array.from({ length: 20 }, () => generateCommitSlug('{alphanum8}')));
    // With 36^8 ≈ 2.8 trillion possibilities, collisions in 20 draws are astronomically unlikely
    expect(slugs.size).toBeGreaterThan(1);
  });
});
