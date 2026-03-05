// src/server/utils/errorSanitizer.ts
// Shared error-sanitization helpers used by server API routes.

/**
 * Converts an unknown caught value to a safe, non-leaking error string.
 * Strips embedded credentials and absolute file-system paths.
 * Credentials are stripped first so URL paths are not partially exposed.
 */
export function sanitizeError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  // Strip embedded credentials (must run before path stripping to avoid exposing URL paths)
  msg = msg.replace(/https?:\/\/[^@\s]+@/gi, 'https://<credentials>@');
  // Strip absolute file-system paths; negative lookbehind avoids matching URL schemes (https://)
  msg = msg.replace(/(?<![a-zA-Z:/\\])(?:[A-Za-z]:)?[/\\][^ \t\n"']*/g, '[path]');
  return msg;
}

/**
 * Same as sanitizeError but applies git-specific credential stripping
 * (handles git remote URLs with embedded user:token pairs).
 */
export function sanitizeGitError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  // Strip embedded git credentials (https://user:token@host)
  msg = msg.replace(/https?:\/\/[^@\s]+@/gi, 'https://<credentials>@');
  // Strip absolute paths; negative lookbehind avoids URL scheme matches (https://)
  msg = msg.replace(/(?<![a-zA-Z:/\\])(?:[A-Za-z]:)?[/\\][^ \t\n"']*/g, '[path]');
  return msg;
}
