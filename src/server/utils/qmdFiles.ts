// src/server/utils/qmdFiles.ts
// Shared utility for recursively collecting .qmd file paths under a directory.

import { readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

/**
 * Recursively collects all .qmd file paths under dir.
 * Returns paths relative to root, normalized to forward slashes.
 */
export function collectQmd(dir: string, root: string): string[] {
  let results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(collectQmd(full, root));
      } else if (entry.isFile() && extname(entry.name) === '.qmd') {
        results.push(relative(root, full).replace(/\\/g, '/'));
      }
    }
  } catch { /* ignore unreadable dirs */ }
  return results;
}
