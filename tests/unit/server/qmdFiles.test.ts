import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectQmd } from '../../../src/server/utils/qmdFiles.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'qs-qmdfiles-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('collectQmd', () => {
  it('returns empty array for an empty directory', () => {
    expect(collectQmd(tmpDir, tmpDir)).toEqual([]);
  });

  it('finds a single .qmd file', () => {
    writeFileSync(join(tmpDir, 'hello.qmd'), '');
    const result = collectQmd(tmpDir, tmpDir);
    expect(result).toEqual(['hello.qmd']);
  });

  it('ignores non-.qmd files', () => {
    writeFileSync(join(tmpDir, 'readme.md'), '');
    writeFileSync(join(tmpDir, 'image.png'), '');
    writeFileSync(join(tmpDir, 'data.csv'), '');
    expect(collectQmd(tmpDir, tmpDir)).toEqual([]);
  });

  it('finds .qmd files recursively', () => {
    mkdirSync(join(tmpDir, 'sub'));
    writeFileSync(join(tmpDir, 'root.qmd'), '');
    writeFileSync(join(tmpDir, 'sub', 'child.qmd'), '');
    const result = collectQmd(tmpDir, tmpDir).sort();
    expect(result).toEqual(['root.qmd', 'sub/child.qmd']);
  });

  it('returns paths with forward slashes on all platforms', () => {
    mkdirSync(join(tmpDir, 'a', 'b'), { recursive: true });
    writeFileSync(join(tmpDir, 'a', 'b', 'file.qmd'), '');
    const result = collectQmd(tmpDir, tmpDir);
    expect(result[0]).not.toContain('\\');
  });

  it('returns paths relative to root, not absolute', () => {
    writeFileSync(join(tmpDir, 'note.qmd'), '');
    const result = collectQmd(tmpDir, tmpDir);
    expect(result[0]).not.toContain(tmpDir);
  });

  it('handles deeply nested directories', () => {
    mkdirSync(join(tmpDir, 'a', 'b', 'c', 'd'), { recursive: true });
    writeFileSync(join(tmpDir, 'a', 'b', 'c', 'd', 'deep.qmd'), '');
    const result = collectQmd(tmpDir, tmpDir);
    expect(result).toContain('a/b/c/d/deep.qmd');
  });
});
