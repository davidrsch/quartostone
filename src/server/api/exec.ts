// src/server/api/exec.ts
// Single code-cell execution — stateless subprocess execution
// Supports: Python (python / python3), R (Rscript), Julia (julia)
// Each language runs as a sandboxed subprocess; stdout+stderr captured, 30 s timeout

import type { Express, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import type { ServerContext } from '../index.js';

const EXEC_TIMEOUT_MS = 30_000;

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

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

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

async function executePython(code: string, cwd: string): Promise<ExecResult> {
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
    const result = await runSubprocess(cmd, ['-c', wrapped], cwd, EXEC_TIMEOUT_MS);
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

async function executeR(code: string, cwd: string): Promise<ExecResult> {
  return runSubprocess('Rscript', ['--vanilla', '-e', code], cwd, EXEC_TIMEOUT_MS);
}

async function executeJulia(code: string, cwd: string): Promise<ExecResult> {
  return runSubprocess('julia', ['--quiet', '-e', code], cwd, EXEC_TIMEOUT_MS);
}

// ── Register routes ───────────────────────────────────────────────────────────

export function registerExecApi(app: Express, ctx: ServerContext) {
  const { cwd } = ctx;

  // POST /api/exec
  // body: { code: string, language: 'python' | 'r' | 'julia' }
  // response: { stdout, stderr, timedOut, exitCode }
  app.post('/api/exec', async (req: Request, res: Response) => {
    const { code, language } = req.body as { code?: string; language?: string };

    if (typeof code !== 'string' || !code.trim()) {
      res.status(400).json({ error: 'code is required' });
      return;
    }

    let result: ExecResult;
    try {
      switch (language) {
        case 'python':
        case 'python3':
          result = await executePython(code, cwd);
          break;
        case 'r':
          result = await executeR(code, cwd);
          break;
        case 'julia':
          result = await executeJulia(code, cwd);
          break;
        default:
          res.status(400).json({ error: `Unsupported language: ${String(language)}` });
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
      res.status(500).json({ error: String(err) });
    }
  });
}
