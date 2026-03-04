// src/server/api/export.ts
// Multi-format export: spawn `quarto render` and stream the result as a download.
//
// POST /api/export              body: { path, format, extraArgs? }
// GET  /api/export/status?token  →  { token, status, error?, filename? }
// GET  /api/export/download?token → streams file + deletes temp on complete

import type { Express, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { ServerContext } from '../index.js';
import { isInsideDir } from '../utils/pathGuard.js';
import { EXPORT_FORMATS } from '../../shared/formats.js';

// Alias for backward compatibility with code that references SUPPORTED_FORMATS.
export const SUPPORTED_FORMATS = EXPORT_FORMATS;

export type ExportFormat = typeof EXPORT_FORMATS[number] | string;

// ── Argument security ─────────────────────────────────────────────────────────

const BLOCKED_ARGS = [
  '--output', '--lua-filter', '--extract-media', '--resource-path',
  '--data-dir', '--filter', '--template', '--include-in-header',
  '--include-before-body', '--include-after-body',
];
const SAFE_ARG = /^--[\w-]+(=[\w.,:-]+)?$/;

// ── Job store (in-memory) ─────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'done' | 'error';

interface ExportJob {
  token:     string;
  status:    JobStatus;
  outputPath?: string;
  outDir?:     string;
  filename?:   string;
  error?:      string;
  stderr:      string;
  createdAt:   number;
}

const jobs = new Map<string, ExportJob>();

/** Keeps only the most recent 100 jobs in memory by evicting the oldest entries. */
function purgeOldJobs(): void {
  // simple approach: keep only the last 100 jobs
  if (jobs.size > 100) {
    const oldest = Array.from(jobs.keys()).slice(0, jobs.size - 100);
    for (const k of oldest) jobs.delete(k);
  }
}

// Time-based cleanup: purge jobs and their temp dirs older than 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt && job.createdAt < cutoff) {
      jobs.delete(id);
      if (job.outDir) {
        try { rmSync(job.outDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }
}, 5 * 60 * 1000).unref();

// ── Quarto runner ─────────────────────────────────────────────────────────────

function outputExt(format: string): string {
  switch (format) {
    case 'html':
    case 'revealjs': return '.html';
    case 'pdf':
    case 'beamer':   return '.pdf';
    case 'typst':    return '.pdf';
    case 'docx':     return '.docx';
    case 'epub':     return '.epub';
    default:         return '.out';
  }
}

function runExport(
  cwd:      string,
  filePath: string,
  format:   string,
  extraArgs: string[],
  job:      ExportJob,
): void {
  const ext  = outputExt(format);
  const stem = basename(filePath, extname(filePath));
  const outDir  = mkdtempSync(join(tmpdir(), 'qs-export-'));
  const outFile = join(outDir, `${stem}${ext}`);

  const htmlArgs = format === 'html'
    ? ['--standalone', '--embed-resources']
    : format === 'revealjs'
    ? ['--standalone']
    : [];

  const args = [
    'render', filePath,
    '--to', format,
    '--output', outFile,
    ...htmlArgs,
    ...extraArgs,
  ];

  job.status = 'running';

  const proc = spawn('quarto', args, { cwd, shell: false });

  let stderr = '';
  proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  proc.stdout.on('data', () => { /* discard */ });

  proc.on('error', (err) => {
    const msg = err.message;
    job.status = 'error';
    job.stderr = stderr;
    try { rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      job.error = 'Quarto is not installed or not on PATH. Install from https://quarto.org';
    } else {
      job.error = msg;
    }
  });

  proc.on('close', (code) => {
    if (code === 0 && existsSync(outFile)) {
      job.status   = 'done';
      job.outputPath = outFile;
      job.outDir   = outDir;
      job.filename   = `${stem}${ext}`;
      job.stderr   = stderr;
    } else {
      job.status = 'error';
      job.stderr = stderr;
      try { rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
      // Detect common missing-dependency messages
      if (stderr.includes('xelatex') || stderr.includes('pdflatex') || stderr.includes('LaTeX')) {
        job.error = 'LaTeX is not installed. Install TeX Live or MiKTeX, or choose the "typst" format instead.';
      } else if (stderr.includes('typst') && stderr.includes('not found')) {
        job.error = 'typst is not installed. Install from https://typst.app or via `cargo install typst-cli`.';
      } else {
        job.error = stderr.trim() || `quarto render exited with code ${String(code)}`;
      }
    }
  });
}

// ── Register routes ───────────────────────────────────────────────────────────

export function registerExportApi(app: Express, ctx: ServerContext) {
  const { cwd } = ctx;

  // POST /api/export  body: { path: string; format: string; extraArgs?: string[] }
  app.post('/api/export', (req: Request, res: Response) => {
    const { path: filePath, format, extraArgs = [] } = req.body as {
      path?:      string;
      format?:    string;
      extraArgs?: string[];
    };

    if (!filePath) return res.status(400).json({ error: 'path is required' });
    if (!format || !SUPPORTED_FORMATS.includes(format as typeof SUPPORTED_FORMATS[number])) {
      return res.status(400).json({ error: `Unsupported format. Valid formats: ${SUPPORTED_FORMATS.join(', ')}` });
    }

    const pagesRoot = resolve(join(cwd, ctx.config.pages_dir));
    const absPath = resolve(join(cwd, filePath));
    if (!isInsideDir(pagesRoot, absPath)) {
      return res.status(400).json({ error: 'Path traversal not allowed' });
    }
    if (!existsSync(absPath)) return res.status(404).json({ error: 'File not found' });

    if (!Array.isArray(extraArgs)) {
      return res.status(400).json({ error: 'extraArgs must be an array' });
    }
    // Reject requests that include blocked or unsafe arguments (security)
    const badArg = extraArgs.find((a: unknown): boolean => {
      if (typeof a !== 'string') return true;
      if (!SAFE_ARG.test(a)) return true;
      return BLOCKED_ARGS.some(b => a === b || (a as string).startsWith(b + '='));
    });
    if (badArg !== undefined) {
      return res.status(400).json({ error: `Blocked or unsafe argument: ${String(badArg)}` });
    }
    const safeExtraArgs = extraArgs as string[];

    purgeOldJobs();
    const token = randomUUID();
    const job: ExportJob = { token, status: 'pending', stderr: '', createdAt: Date.now() };
    jobs.set(token, job);

    // Start async — respond immediately with token
    setImmediate(() => runExport(cwd, absPath, format, safeExtraArgs, job));

    res.json({ token, status: 'pending' });
  });

  // GET /api/export/formats — returns the list of supported export formats
  app.get('/api/export/formats', (_req: Request, res: Response) => {
    res.json({ formats: EXPORT_FORMATS });
  });

  // GET /api/export/status?token=
  app.get('/api/export/status', (req: Request, res: Response) => {
    const token = req.query['token'] as string | undefined;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const job = jobs.get(token);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    res.json({
      token:    job.token,
      status:   job.status,
      filename: job.filename,
      error:    job.error,
    });
  });

  // GET /api/export/download?token=
  // Streams the output file to the client, then deletes it.
  app.get('/api/export/download', (req: Request, res: Response) => {
    const token = req.query['token'] as string | undefined;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const job = jobs.get(token);
    if (!job)              return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'done' || !job.outputPath || !job.filename) {
      return res.status(409).json({ error: `Job is not complete (status: ${job.status})` });
    }

    if (!existsSync(job.outputPath)) {
      return res.status(410).json({ error: 'Output file no longer exists' });
    }

    const mimeMap: Record<string, string> = {
      '.html': 'text/html',
      '.pdf':  'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.epub': 'application/epub+zip',
    };
    const ext  = extname(job.filename);
    const mime = mimeMap[ext] ?? 'application/octet-stream';

    res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
    res.setHeader('Content-Type', mime);

    const stream = createReadStream(job.outputPath);
    stream.on('error', (_err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'File read error' });
      } else {
        res.destroy();
      }
    });
    stream.on('end', () => {
      try { if (job.outDir) rmSync(job.outDir, { recursive: true, force: true }); } catch { /* ignore */ }
      jobs.delete(token);
    });
    stream.pipe(res);
  });
}
