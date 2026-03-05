// tests/unit/server/logger.test.ts
// Unit tests for the structured logger utility.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { log, warn, error } from '../../../src/server/utils/logger.js';

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('log() writes [quartostone] prefix + message to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    log('hello world');
    expect(write).toHaveBeenCalledWith('[quartostone] hello world\n');
  });

  it('warn() writes [quartostone] WARN prefix + message to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    warn('something fishy');
    expect(write).toHaveBeenCalledWith('[quartostone] WARN something fishy\n');
  });

  it('error() writes [quartostone] ERROR prefix + message to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    error('it broke');
    expect(write).toHaveBeenCalledWith('[quartostone] ERROR it broke\n');
  });

  it('all functions write to stderr, not stdout', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    log('a'); warn('b'); error('c');
    expect(stderrWrite).toHaveBeenCalledTimes(3);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
