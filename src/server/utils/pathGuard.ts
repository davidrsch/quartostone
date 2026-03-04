// src/server/utils/pathGuard.ts
// Shared path-traversal guard utilities used across server API handlers.

import { resolve, join, sep } from 'node:path';

export class PathTraversalError extends Error {
  constructor(rawPath: string) {
    super(`Path traversal attempt: ${rawPath}`);
    this.name = 'PathTraversalError';
  }
}

/**
 * Resolves rawPath inside root. Throws PathTraversalError if the result is
 * outside root or equals root itself.
 *
 * Uses path.join to prevent absolute-path injection: even if rawPath looks
 * like an absolute path, it is treated as a segment relative to root.
 */
export function resolveInsideDir(root: string, rawPath: string): string {
  const resolvedRoot = resolve(root);
  const abs = resolve(join(resolvedRoot, rawPath));
  if (!abs.startsWith(resolvedRoot + sep) || abs === resolvedRoot) {
    throw new PathTraversalError(rawPath);
  }
  return abs;
}

/**
 * Returns true only if rawPath resolves strictly inside root (not equal to root).
 *
 * NOTE: This function uses path.resolve(root, rawPath) so that callers which
 * pass relative paths (resolved against root) AND callers that pass pre-computed
 * absolute paths both work correctly.
 */
export function isInsideDir(root: string, rawPath: string): boolean {
  const resolvedRoot = resolve(root);
  const abs = resolve(resolvedRoot, rawPath);
  return abs.startsWith(resolvedRoot + sep);
}
