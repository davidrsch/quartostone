import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { resolveInsideDir, isInsideDir, PathTraversalError } from '../../../src/server/utils/pathGuard.js';

const ROOT = '/var/pages';

describe('resolveInsideDir', () => {
  it('resolves a simple relative path under root', () => {
    const result = resolveInsideDir(ROOT, 'notes/hello.qmd');
    expect(result).toMatch(/notes[/\\]hello\.qmd$/);
  });

  it('throws PathTraversalError for .. traversal', () => {
    expect(() => resolveInsideDir(ROOT, '../etc/passwd')).toThrow(PathTraversalError);
    expect(() => resolveInsideDir(ROOT, '../etc/passwd')).toThrow(/Path traversal/);
  });

  it('throws PathTraversalError for deeply nested traversal', () => {
    expect(() => resolveInsideDir(ROOT, 'a/b/c/../../../../../../../etc/shadow')).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError when rawPath equals root itself', () => {
    // resolveInsideDir(root, '') resolves to root — should throw
    expect(() => resolveInsideDir(ROOT, '')).toThrow();
  });

  it('resolves nested path correctly', () => {
    const result = resolveInsideDir(ROOT, 'sub/dir/file.qmd');
    expect(result).toContain('sub');
    expect(result).toContain('file.qmd');
  });

  it('treats a POSIX absolute path as a relative segment inside root (path.join safety)', () => {
    // path.join(root, '/etc/passwd') strips the leading slash on POSIX and
    // prepends root on Windows, so the result stays inside root — no throw.
    const result = resolveInsideDir(ROOT, '/etc/passwd');
    expect(result).toContain('etc');
    expect(result).toContain('passwd');
  });
});

describe('isInsideDir', () => {
  it('returns true for a path inside root', () => {
    const abs = join(ROOT, 'notes', 'hello.qmd');
    expect(isInsideDir(ROOT, abs)).toBe(true);
  });

  it('returns false for a path outside root', () => {
    expect(isInsideDir(ROOT, '/etc/passwd')).toBe(false);
  });

  it('returns false for root itself', () => {
    expect(isInsideDir(ROOT, ROOT)).toBe(false);
  });

  it('returns false for a sibling directory', () => {
    expect(isInsideDir(ROOT, '/var/other')).toBe(false);
  });

  it('returns true for deeply nested path inside root', () => {
    const deep = join(ROOT, 'a', 'b', 'c', 'file.qmd');
    expect(isInsideDir(ROOT, deep)).toBe(true);
  });

  it('handles path with trailing slash in input correctly', () => {
    const abs = join(ROOT, 'notes') + '/';
    // A directory inside root — still inside
    expect(isInsideDir(ROOT, abs)).toBe(true);
  });
});

describe('PathTraversalError', () => {
  it('is an instance of Error', () => {
    const err = new PathTraversalError('test');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name PathTraversalError', () => {
    const err = new PathTraversalError('test');
    expect(err.name).toBe('PathTraversalError');
  });

  it('includes the raw path in the message', () => {
    const err = new PathTraversalError('../secret');
    expect(err.message).toContain('../secret');
  });
});
