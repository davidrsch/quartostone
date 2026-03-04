// tests/unit/server/asyncRoute.test.ts
// Unit tests for the asyncRoute Express helper utility.

import { describe, it, expect, vi } from 'vitest';
import { asyncRoute } from '../../../src/server/utils/asyncRoute.js';
import type { Request, Response, NextFunction } from 'express';

/** Creates minimal mock req/res/next objects for testing. */
function makeCtx() {
  const req = {} as Request;
  const res = { send: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('asyncRoute', () => {
  it('returns a function (the Express middleware wrapper)', () => {
    const handler = asyncRoute(async (_req, res) => { res.json({ ok: true }); });
    expect(typeof handler).toBe('function');
  });

  it('calls the wrapped async handler and does not call next for a successful response', async () => {
    const { req, res, next } = makeCtx();
    const fn = vi.fn().mockResolvedValue(undefined);
    const middleware = asyncRoute(fn);

    await middleware(req, res, next);

    expect(fn).toHaveBeenCalledWith(req, res);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a rejected promise to next(err)', async () => {
    const { req, res, next } = makeCtx();
    const error = new Error('test error');
    const fn = vi.fn().mockRejectedValue(error);
    const middleware = asyncRoute(fn);

    // The rejection is swallowed by .catch(next); we wait a tick for the microtask.
    middleware(req, res, next);
    await new Promise(r => setTimeout(r, 10));

    expect(next).toHaveBeenCalledWith(error);
  });
});
