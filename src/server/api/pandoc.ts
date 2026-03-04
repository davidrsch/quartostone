// src/server/api/pandoc.ts
// Thin pandoc proxy routes for the panmirror visual editor.
//
// POST /api/pandoc/capabilities        → PandocCapabilitiesResult
// POST /api/pandoc/markdownToAst       body: { markdown, format, options }   → PandocAst (JSON)
// POST /api/pandoc/astToMarkdown       body: { ast, format, options }         → string
// POST /api/pandoc/listExtensions      body: { format }                       → string
// POST /api/pandoc/getBibliography     body: { ... }                          → BibliographyResult stub
// POST /api/pandoc/addToBibliography   body: { ... }                          → boolean
// POST /api/pandoc/citationHTML        body: { ... }                          → string

import type { Express, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import type { ServerContext } from '../index.js';

const PANDOC_TIMEOUT_MS = 30_000;

// ── Module-level capabilities cache ─────────────────────────────────────────

let capabilitiesCache: unknown | null = null;

/** Reset the capabilities cache — primarily for use in tests. */
export function resetCapabilitiesCache(): void {
  capabilitiesCache = null;
}

// ── Subprocess helper ─────────────────────────────────────────────────────────

interface ProcResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  notFound?: boolean;
}

function runPandoc(args: string[], stdin?: string): Promise<ProcResult> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = spawn('pandoc', args, { shell: false });

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, PANDOC_TIMEOUT_MS);

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        stdout, stderr: err.message, exitCode: null, timedOut: false,
        notFound: err.code === 'ENOENT',
      });
    });

    if (stdin !== undefined) {
      proc.stdin.write(stdin, 'utf8');
      proc.stdin.end();
    }
  });
}

// ── Route helpers ─────────────────────────────────────────────────────────────

function pandocError(res: Response, detail: string, code = 500) {
  res.status(code).json({ error: detail });
}
// ── Shared option sanitiser ───────────────────────────────────────────────────

const SAFE_PANDOC_OPTION = /^--[a-zA-Z][\w-]*(?:=[^\s;|&`$<>'"\\]+)?$/;
const BLOCKED_FLAGS = ['--output', '--lua-filter', '--extract-media', '--resource-path', '--data-dir', '--filter', '--template'];

function sanitisePandocOptions(rawOptions: unknown): string[] {
  return Array.isArray(rawOptions)
    ? rawOptions.filter((o): o is string => {
        if (typeof o !== 'string') return false;
        if (!SAFE_PANDOC_OPTION.test(o)) return false;
        return !BLOCKED_FLAGS.some(b => o === b || o.startsWith(b + '='));
      })
    : [];
}
// ── Route registration ────────────────────────────────────────────────────────

export function registerPandocApi(app: Express, _ctx: ServerContext): void {

  // GET /api/pandoc/capabilities
  app.post('/api/pandoc/capabilities', async (_req: Request, res: Response) => {
    // Return cached result if available
    if (capabilitiesCache !== null) {
      return res.json(capabilitiesCache);
    }

    const [ver, , out, hl] = await Promise.all([
      runPandoc(['--version']),
      runPandoc(['--to', 'json', '--from', 'markdown', '/dev/null']).catch(() =>
        runPandoc(['--to', 'json', '--from', 'markdown'], ''), // fallback with empty stdin
      ),
      runPandoc(['--list-output-formats']),
      runPandoc(['--list-highlight-languages']),
    ]);

    if (ver.notFound || out.notFound || hl.notFound ||
        ver.exitCode !== 0 || out.exitCode !== 0 || hl.exitCode !== 0) {
      return res.status(503).json({ error: 'pandoc not available' });
    }

    // Parse version from first line: "pandoc X.Y.Z"
    const versionLine = ver.stdout.split('\n')[0] ?? '';
    const version = versionLine.replace(/^pandoc\s+/, '').trim();

    // Parse API version from the JSON output (the json format embeds it)
    let api_version: number[] = [3, 1, 1];
    try {
      // Run a quick empty JSON doc to get api version
      const r2 = await runPandoc(['--from', 'markdown', '--to', 'json'], '');
      if (r2.exitCode === 0) {
        const doc = JSON.parse(r2.stdout) as { 'pandoc-api-version': number[] };
        api_version = doc['pandoc-api-version'] ?? api_version;
      }
    } catch { /* use default */ }

    const result = {
      version,
      api_version,
      output_formats: out.stdout.trim(),
      highlight_languages: hl.stdout.trim(),
    };
    capabilitiesCache = result;
    return res.json(result);
  });

  // POST /api/pandoc/markdownToAst
  app.post('/api/pandoc/markdownToAst', async (req: Request, res: Response) => {
    const { markdown, format } = req.body as {
      markdown: string;
      format: string;
    };
    if (typeof markdown !== 'string' || typeof format !== 'string') {
      return pandocError(res, 'markdown and format required', 400);
    }
    if (!format || !/^[\w+-]+$/.test(format)) {
      return res.status(400).json({ error: 'Invalid or missing format' });
    }

    const safeOptions = sanitisePandocOptions(req.body.options);

    const args = [
      '--from', format,
      '--to', 'json',
      ...safeOptions,
    ];

    const result = await runPandoc(args, markdown);

    if (result.notFound) return pandocError(res, 'pandoc not found', 503);
    if (result.timedOut) return pandocError(res, 'pandoc timed out', 504);
    if (result.exitCode !== 0) return pandocError(res, result.stderr || 'pandoc error');

    try {
      const ast = JSON.parse(result.stdout) as unknown;
      res.json(ast);
    } catch {
      return pandocError(res, 'failed to parse pandoc JSON output');
    }
  });

  // POST /api/pandoc/astToMarkdown
  app.post('/api/pandoc/astToMarkdown', async (req: Request, res: Response) => {
    const { ast, format } = req.body as {
      ast: unknown;
      format: string;
    };
    if (!ast || typeof format !== 'string') {
      return pandocError(res, 'ast and format required', 400);
    }
    if (!format || !/^[\w+-]+$/.test(format)) {
      return res.status(400).json({ error: 'Invalid or missing format' });
    }

    const safeOptions = sanitisePandocOptions(req.body.options);

    const args = [
      '--from', 'json',
      '--to', format,
      ...safeOptions,
    ];

    const result = await runPandoc(args, JSON.stringify(ast));

    if (result.notFound) return pandocError(res, 'pandoc not found', 503);
    if (result.timedOut) return pandocError(res, 'pandoc timed out', 504);
    if (result.exitCode !== 0) return pandocError(res, result.stderr || 'pandoc error');

    res.json(result.stdout);
  });

  // POST /api/pandoc/listExtensions
  app.post('/api/pandoc/listExtensions', async (req: Request, res: Response) => {
    const { format } = req.body as { format?: string };
    if (!format || !/^[\w+-]+$/.test(format)) {
      return res.status(400).json({ error: 'Invalid format' });
    }
    const args = format ? [`--list-extensions=${format}`] : ['--list-extensions'];
    const result = await runPandoc(args);
    if (result.notFound) return pandocError(res, 'pandoc not found', 503);
    res.json(result.stdout.trim());
  });

  // POST /api/pandoc/getBibliography — stub (no bibliography support yet)
  app.post('/api/pandoc/getBibliography', (_req: Request, res: Response) => {
    res.json({
      etag: Date.now().toString(),
      bibliography: {
        sources: [],
        project_biblios: [],
      },
    });
  });

  // POST /api/pandoc/addToBibliography — no-op
  app.post('/api/pandoc/addToBibliography', (_req: Request, res: Response) => {
    res.json(true);
  });

  // POST /api/pandoc/citationHTML — stub
  app.post('/api/pandoc/citationHTML', (_req: Request, res: Response) => {
    res.json('');
  });
}
