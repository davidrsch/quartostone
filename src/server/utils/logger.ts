// src/server/utils/logger.ts
// Lightweight structured logger for quartostone server code.
// Writes to stderr to keep stdout clean for potential piping / JSON output.

const PREFIX = '[quartostone]';

export function log(msg: string): void {
  process.stderr.write(`${PREFIX} ${msg}\n`);
}

export function warn(msg: string): void {
  process.stderr.write(`${PREFIX} WARN ${msg}\n`);
}

export function error(msg: string): void {
  process.stderr.write(`${PREFIX} ERROR ${msg}\n`);
}
