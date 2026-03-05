// src/server/utils/spawnCapture.ts
import { spawn } from 'node:child_process';

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  notFound: boolean;
}

export interface SpawnOptions {
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawns a subprocess, captures stdout+stderr, and resolves with the result.
 * Returns timedOut=true if the process is killed by the optional timeout.
 * Returns notFound=true if the binary is not on PATH (ENOENT spawn error).
 */
export function spawnCapture(
  cmd: string,
  args: string[],
  opts: SpawnOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      shell: false,
      stdio: 'pipe',
      env: opts.env,
    });

    const maxBytes = opts.maxOutputBytes ?? 10 * 1_048_576; // 10 MB default
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let notFound = false;

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString();
    });

    // Write stdin data and close the stream so the subprocess can read it.
    if (opts.stdin !== undefined) {
      proc.stdin?.write(opts.stdin, 'utf-8');
      proc.stdin?.end();
    }

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, opts.timeoutMs)
      : null;

    proc.on('error', (err) => {
      const errno = err as NodeJS.ErrnoException;
      // Detect "binary not on PATH" both via the standard code and via the
      // error message string (the latter covers test environments where the
      // error is constructed without a .code property).
      const isEnoent = errno.code === 'ENOENT' || err.message.includes('ENOENT');
      if (isEnoent) {
        notFound = true;
        // Surface the raw error message so callers can include it in responses.
        if (!stderr) stderr = err.message;
      }
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: null, timedOut, notFound });
    });

    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut, notFound });
    });
  });
}
