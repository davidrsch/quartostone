import { describe, it, expect } from 'vitest';
import { sanitizeError, sanitizeGitError } from '../../../src/server/utils/errorSanitizer.js';

describe('sanitizeError', () => {
  it('strips POSIX absolute paths', () => {
    const err = new Error('Failed to read /var/pages/notes/secret.qmd');
    expect(sanitizeError(err)).not.toContain('/var/pages');
    expect(sanitizeError(err)).toContain('[path]');
  });

  it('strips Windows absolute paths', () => {
    const err = new Error('Cannot access C:\\Users\\user\\pages\\file.qmd');
    expect(sanitizeError(err)).not.toContain('C:\\Users');
    expect(sanitizeError(err)).toContain('[path]');
  });

  it('strips embedded HTTP credentials', () => {
    const err = new Error('Fetch failed: https://user:secret@api.example.com/endpoint');
    expect(sanitizeError(err)).not.toContain('secret');
    expect(sanitizeError(err)).toContain('<credentials>');
  });

  it('preserves meaningful error text without paths', () => {
    expect(sanitizeError(new Error('Connection refused'))).toBe('Connection refused');
  });

  it('handles non-Error values', () => {
    expect(sanitizeError('plain string error')).toBe('plain string error');
    expect(sanitizeError(42)).toBe('42');
    expect(sanitizeError(null)).toBe('null');
  });
});

describe('sanitizeGitError', () => {
  it('strips absolute paths from git errors', () => {
    const err = new Error("fatal: not a git repository (or any of the parent directories): /home/user/repo/.git");
    const result = sanitizeGitError(err);
    expect(result).not.toContain('/home/user');
    expect(result).toContain('[path]');
  });

  it('strips embedded git credentials', () => {
    const err = new Error('remote: error authenticating https://user:token123@github.com/repo.git');
    const result = sanitizeGitError(err);
    expect(result).not.toContain('token123');
    expect(result).toContain('<credentials>');
  });

  it('preserves git error text without credentials', () => {
    const err = new Error('not possible to fast-forward, aborting.');
    expect(sanitizeGitError(err)).toBe('not possible to fast-forward, aborting.');
  });

  it('handles non-Error values', () => {
    expect(sanitizeGitError('git error')).toBe('git error');
  });
});
