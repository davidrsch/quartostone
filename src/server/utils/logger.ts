// src/server/utils/logger.ts
// Lightweight structured logger for quartostone server code.
// Writes to stderr to keep stdout clean for potential piping / JSON output.

const PREFIX = '[quartostone]';

/** Writes an info-level message to stderr with the quartostone prefix. */
export function log(msg: string): void {
  process.stderr.write(`${PREFIX} ${msg}\n`);
}

/** Writes a warning-level message to stderr with the quartostone prefix. */
export function warn(msg: string): void {
  process.stderr.write(`${PREFIX} WARN ${msg}\n`);
}

/** Writes an error-level message to stderr with the quartostone prefix. */
export function error(msg: string): void {
  process.stderr.write(`${PREFIX} ERROR ${msg}\n`);
}
