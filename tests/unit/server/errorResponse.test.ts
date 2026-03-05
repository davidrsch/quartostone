// tests/unit/server/errorResponse.test.ts
// Unit tests for the typed HTTP error response helpers.

import { describe, it, expect, vi } from 'vitest';
import {
  badRequest,
  notFound,
  conflict,
  serverError,
  forbidden,
} from '../../../src/server/utils/errorResponse.js';
import type { Response } from 'express';

/** Creates a minimal mock Express Response with chainable status(). */
function makeMockRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
}

describe('errorResponse helpers', () => {
  it('badRequest() calls res.status(400).json({ error: msg })', () => {
    const { res, status, json } = makeMockRes();
    badRequest(res, 'name required');
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'name required' });
  });

  it('notFound() calls res.status(404).json({ error: msg })', () => {
    const { res, status, json } = makeMockRes();
    notFound(res, 'page not found');
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'page not found' });
  });

  it('conflict() calls res.status(409).json({ error: msg })', () => {
    const { res, status, json } = makeMockRes();
    conflict(res, 'already exists');
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: 'already exists' });
  });

  it('serverError() calls res.status(500).json({ error: msg })', () => {
    const { res, status, json } = makeMockRes();
    serverError(res, 'unexpected failure');
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'unexpected failure' });
  });

  it('forbidden() calls res.status(403).json({ error: msg })', () => {
    const { res, status, json } = makeMockRes();
    forbidden(res, 'access denied');
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'access denied' });
  });

  it('each helper returns the result of res.status().json()', () => {
    const json = vi.fn().mockReturnValue('SENTINEL');
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;
    expect(badRequest(res, 'x')).toBe('SENTINEL');
  });
});
