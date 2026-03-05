// src/server/api/db.ts
// Database page API — read/write structured .qmd files
// Format: YAML frontmatter (quartostone: database + schema) + Markdown table

import type { Express, Request, Response } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { ServerContext } from '../index.js';
import { parseFrontmatter } from '../utils/frontmatter.js';
import type { FieldDef, DbPage } from '../../shared/types.js';
import { sanitizeError } from '../utils/errorSanitizer.js';
import { isInsideDir } from '../utils/pathGuard.js';
import { badRequest, notFound, conflict, serverError } from '../utils/errorResponse.js';

// Re-export shared types so existing imports from this module keep working.
export type { FieldDef, DbPage };

// ── Markdown table helpers ──────────────────────────────────────────────────

function parseMarkdownTable(src: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = src.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] =>
    line.split('|').slice(1, -1).map(c => c.trim());

  const headers = parseRow(lines[0]);
  const dataLines = lines.slice(2); // skip separator line

  const rows: Record<string, string>[] = dataLines.map(line => {
    const cells = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });

  return { headers, rows };
}

function serializeMarkdownTable(schema: FieldDef[], rows: Record<string, string>[]): string {
  const ids = schema.map(f => f.id);
  const widths = ids.map(id =>
    Math.max(id.length, ...rows.map(r => (r[id] ?? '').replace(/\|/g, '\\|').length), 3)
  );

  const pad = (s: string, w: number) => s.padEnd(w, ' ');

  const header  = '| ' + ids.map((id, i) => pad(id, widths[i])).join(' | ') + ' |';
  const sep     = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  const dataLines = rows.map(row =>
    '| ' + ids.map((id, i) => {
      const cellText = String(row[id] ?? '').replace(/\|/g, '\\|');
      return pad(cellText, widths[i]);
    }).join(' | ') + ' |'
  );

  return [header, sep, ...dataLines].join('\n');
}

// ── Parse / serialise a database .qmd file ───────────────────────────────────

const VALID_FIELD_TYPES: ReadonlySet<string> = new Set(['text', 'select', 'date', 'checkbox', 'number']);

function normaliseSchema(raw: unknown): FieldDef[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map(f => {
    const rawType = String(f['type'] ?? 'text').toLowerCase();
    const type: FieldDef['type'] = VALID_FIELD_TYPES.has(rawType)
      ? (rawType as FieldDef['type'])
      : 'text'; // unknown types silently fall back to text
    return {
      id:      String(f['id'] ?? f['name'] ?? 'field').toLowerCase().replace(/\s+/g, '_'),
      name:    String(f['name'] ?? f['id'] ?? 'Field'),
      type,
      options: Array.isArray(f['options']) ? (f['options'] as string[]).map(String) : undefined,
    };
  });
}

export function parseDbFile(content: string): DbPage | null {
  const { meta, body } = parseFrontmatter(content);
  if (meta['quartostone'] !== 'database') return null;
  const schema = normaliseSchema(meta['schema']);
  const { rows } = parseMarkdownTable(body);
  return { schema, rows };
}

export function serialiseDbFile(page: DbPage): string {
  const frontmatter: Record<string, unknown> = {
    quartostone: 'database',
    schema: page.schema.map(f => {
      const obj: Record<string, unknown> = { id: f.id, name: f.name, type: f.type };
      if (f.options) obj['options'] = f.options;
      return obj;
    }),
  };

  const fmStr = yamlStringify(frontmatter).trimEnd();
  const tableStr = page.rows.length > 0 || page.schema.length > 0
    ? '\n' + serializeMarkdownTable(page.schema, page.rows) + '\n'
    : '';

  return `---\n${fmStr}\n---\n${tableStr}`;
}

// ── Route handlers ───────────────────────────────────────────────────────────

async function resolveAndCheck(cwd: string, pagesDir: string, rawPath: string | undefined, res: Response)
  : Promise<string | null>
{
  if (!rawPath) { badRequest(res, 'Missing path parameter'); return null; }
  const abs = resolve(join(cwd, rawPath));
  if (!isInsideDir(resolve(pagesDir), abs)) {
    badRequest(res, 'Path traversal not allowed');
    return null;
  }
  return abs;
}

// ── Register routes ──────────────────────────────────────────────────────────

export function registerDbApi(app: Express, ctx: ServerContext) {
  const { cwd } = ctx;
  const pagesDir = join(cwd, ctx.config.pages_dir);

  // GET /api/db?path=pages/tasks.qmd  → { schema, rows }
  app.get('/api/db', async (req: Request, res: Response) => {
    const abs = await resolveAndCheck(cwd, pagesDir, req.query['path'] as string | undefined, res);
    if (!abs) return;
    try {
      const content = await readFile(abs, 'utf-8');
      const db = parseDbFile(content);
      if (!db) {
        badRequest(res, 'File is not a Quartostone database page');
        return;
      }
      res.json(db);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return notFound(res, 'Database file not found');
      }
      return serverError(res, 'Failed to read database file');
    }
  });

  // PUT /api/db?path=pages/tasks.qmd  body: { schema, rows }
  app.put('/api/db', async (req: Request, res: Response) => {
    const abs = await resolveAndCheck(cwd, pagesDir, req.query['path'] as string | undefined, res);
    if (!abs) return;
    try {
      const { schema, rows } = req.body as DbPage;
      if (!Array.isArray(schema)) {
        badRequest(res, 'schema must be an array');
        return;
      }
      if (rows !== undefined && !Array.isArray(rows)) {
        return badRequest(res, 'rows must be an array');
      }
      const content = serialiseDbFile({ schema: normaliseSchema(schema), rows: rows ?? [] });
      await writeFile(abs, content, 'utf-8');
      res.json({ ok: true });
    } catch (err) {
      serverError(res, sanitizeError(err));
    }
  });

  // POST /api/db/create?path=...  body: { title, schema? }
  // Creates a new database .qmd file
  app.post('/api/db/create', async (req: Request, res: Response) => {
    const abs = await resolveAndCheck(cwd, pagesDir, req.query['path'] as string | undefined, res);
    if (!abs) return;
    try {
      const { title = 'Untitled Database', schema } = req.body as {
        title?: string;
        schema?: unknown[];
      };
      const defaultSchema: FieldDef[] = [
        { id: 'name',   name: 'Name',   type: 'text'   },
        { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Doing', 'Done'] },
        { id: 'due',    name: 'Due',    type: 'date'   },
      ];
      const finalSchema = schema ? normaliseSchema(schema) : defaultSchema;
      const frontmatter: Record<string, unknown> = {
        title,
        quartostone: 'database',
        schema: finalSchema.map(f => {
          const obj: Record<string, unknown> = { id: f.id, name: f.name, type: f.type };
          if (f.options) obj['options'] = f.options;
          return obj;
        }),
      };
      const fmStr = yamlStringify(frontmatter).trimEnd();
      const tableStr = '\n' + serializeMarkdownTable(finalSchema, []) + '\n';
      const content = `---\n${fmStr}\n---\n${tableStr}`;
      try {
        await writeFile(abs, content, { flag: 'wx', encoding: 'utf-8' });
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          return conflict(res, 'File already exists');
        }
        throw err;
      }
      res.json({ ok: true });
    } catch (err) {
      serverError(res, sanitizeError(err));
    }
  });
}
