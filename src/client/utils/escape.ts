/**
 * Escapes a string for safe insertion into HTML text content or attribute values.
 * Encodes &, <, >, and " characters.
 */
export function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escapes a string for safe use inside an HTML attribute (double-quoted).
 * Same as escHtml for double-quoted attributes.
 */
export function escAttr(s: string): string {
  return escHtml(s);
}
