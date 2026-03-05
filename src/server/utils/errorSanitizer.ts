// src/server/utils/errorSanitizer.ts
// Shared error-sanitization helpers used by server API routes.

/**
 * Converts an unknown caught value to a safe, non-leaking error string.
 * Strips absolute file-system paths and embedded credentials.
 */
export function sanitizeError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  msg = msg.replace(/(?:[A-Za-z]:)?[/\\][^ \t\n"']*/g, '[path]');
  msg = msg.replace(/https?:\/\/[^@\s]+@/gi, 'https://<credentials>@');
  return msg;
}

/**
 * Same as sanitizeError but uses git-specific credential stripping
 * (handles git remote URLs with embedded user:token pairs).
 */
export function sanitizeGitError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  // Remove absolute paths (e.g. /home/user/... or C:\Users\...)
  msg = msg.replace(/(?:[A-Za-z]:)?[/\\][^ \t\n"']*/g, '[path]');
  // Remove embedded credentials (https://user:token@host)
  msg = msg.replace(/::\/\/[^@\s]+@/g, '://[credentials]@');
  return msg;
}
