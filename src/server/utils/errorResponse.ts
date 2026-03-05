// src/server/utils/errorResponse.ts
// Typed helpers for consistent JSON error responses across all API routes.
// Each helper sends the response and returns it so callers can write:
//   return badRequest(res, 'message required');

import type { Response } from 'express';

/** Sends a 400 Bad Request JSON response with an error message. */
export function badRequest(res: Response, msg: string): Response {
  return res.status(400).json({ error: msg });
}

/** Sends a 404 Not Found JSON response with an error message. */
export function notFound(res: Response, msg: string): Response {
  return res.status(404).json({ error: msg });
}

/** Sends a 409 Conflict JSON response with an error message. */
export function conflict(res: Response, msg: string): Response {
  return res.status(409).json({ error: msg });
}

/** Sends a 500 Internal Server Error JSON response with an error message. */
export function serverError(res: Response, msg: string): Response {
  return res.status(500).json({ error: msg });
}

/** Sends a 403 Forbidden JSON response with an error message. */
export function forbidden(res: Response, msg: string): Response {
  return res.status(403).json({ error: msg });
}
