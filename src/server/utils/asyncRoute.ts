// src/server/utils/asyncRoute.ts
// Wraps an async Express route handler so that any rejected promise is forwarded
// to Express's next(err) error-handler chain.

import type { NextFunction, Request, Response } from 'express';

/**
 * Wraps an async route handler and forwards any rejected promise to Express's
 * global error handler via `next(err)`.
 *
 * Usage:
 *   app.get('/path', asyncRoute(async (req, res) => { ... }));
 */
export function asyncRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}
