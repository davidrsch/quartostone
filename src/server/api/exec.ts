// src/server/api/exec.ts
// Single code-cell execution — stateless subprocess execution
// Supports: Python (python / python3), R (Rscript), Julia (julia)
// Each language runs as a sandboxed subprocess; stdout+stderr captured, 30 s timeout

import type { Express, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import type { ServerContext } from '../context.js';
import { badRequest, forbidden, serverError } from '../utils/errorResponse.js';
import { sanitizeError } from '../utils/errorSanitizer.js';

const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 1_048_576; // 1 MB per stream
const MAX_CONCURRENT_EXECS = 3;
let activeExecs = 0;

// ── Run a code snippet in a subprocess ───────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  notFound?: boolean;   // true when the command binary was not found (ENOENT)
}

function runSubprocess(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<ExecResult> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Rely only on the manual timer (not spawn's built-in timeout) so timedOut
    // is always set before the close event fires, avoiding a race condition.
    const proc = spawn(cmd, args, { cwd, shell: false });

    proc.stdout.on('data', (chunk: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    proc.on('close', exitCode => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut });
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        stdout, stderr: err.message, exitCode: null, timedOut: false,
        notFound: err.code === 'ENOENT' || err.message.includes('ENOENT'),
      });
    });
  });
}

// ── Language-specific execution ───────────────────────────────────────────────

async function executePython(code: string, cwd: string, timeout: number): Promise<ExecResult> {
  // Wrap code with matplotlib non-interactive backend to avoid window popups
  const wrapped = `
import sys, warnings
warnings.filterwarnings('ignore')
try:
    import matplotlib
    matplotlib.use('Agg')
except ImportError:
    pass
${code}
`.trimStart();

  // Try 'python' first, fall back to 'python3'
  for (const cmd of ['python', 'python3']) {
    const result = await runSubprocess(cmd, ['-c', wrapped], cwd, timeout);
    // Only fall through to next candidate when the binary was genuinely not found
    if (!result.notFound) return result;
  }
  return {
    stdout: '',
    stderr: 'Python interpreter not found. Install Python and ensure it is on your PATH.',
    exitCode: 127,
    timedOut: false,
  };
}

async function executeR(code: string, cwd: string, timeout: number): Promise<ExecResult> {
  return runSubprocess('Rscript', ['--vanilla', '-e', code], cwd, timeout);
}

async function executeJulia(code: string, cwd: string, timeout: number): Promise<ExecResult> {
  return runSubprocess('julia', ['--quiet', '-e', code], cwd, timeout);
}

// ── Register routes ───────────────────────────────────────────────────────────

/**
 * Registers the code-execution endpoint (`POST /api/exec`).
 * Only active when `allow_code_execution: true` is set in `_quartostone.yml`.
 * Supports Python (`python`/`python3`), R (`Rscript`), and Julia (`julia`).
 * Each call spawns an isolated subprocess with a configurable timeout
 * (default 30 s). Concurrent executions are capped at MAX_CONCURRENT_EXECS (3)
 * to prevent resource exhaustion.
 */
export function registerExecApi(app: Express, ctx: ServerContext) {
  const { cwd } = ctx;
  const execTimeout = ctx.config.exec_timeout_ms ?? EXEC_TIMEOUT_MS;

  // POST /api/exec
  // body: { code: string, language: 'python' | 'r' | 'julia' }
  // response: { stdout, stderr, timedOut, exitCode }
  app.post('/api/exec', async (req: Request, res: Response) => {
    if (!ctx.config.allow_code_execution) {
      forbidden(res, 'Code execution is disabled. Set allow_code_execution: true in _quartostone.yml to enable it.');
      return;
    }

    const { code, language } = req.body as { code?: string; language?: string };

    if (typeof code !== 'string' || !code.trim()) {
      badRequest(res, 'code is required');
      return;
    }

    if (typeof language !== 'string') {
      badRequest(res, 'language is required');
      return;
    }

    if (activeExecs >= MAX_CONCURRENT_EXECS) {
      res.status(429).json({ error: 'Too many concurrent executions. Try again later.' });
      return;
    }
    activeExecs++;

    let result: ExecResult;
    try {
      switch (language) {
        case 'python':
        case 'python3':
          result = await executePython(code, cwd, execTimeout);
          break;
        case 'r':
          result = await executeR(code, cwd, execTimeout);
          break;
        case 'julia':
          result = await executeJulia(code, cwd, execTimeout);
          break;
        default:
          badRequest(res, 'Unsupported language');
          return;
      }

      res.json({
        stdout:   result.stdout,
        stderr:   result.stderr,
        timedOut: result.timedOut,
        exitCode: result.exitCode,
        ok:       result.exitCode === 0 && !result.timedOut,
      });
    } catch (err) {
      serverError(res, sanitizeError(err));
    } finally {
      activeExecs--;
    }
  });
}
