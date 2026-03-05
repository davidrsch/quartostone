// src/server/api/xref.ts
// Cross-reference scanner for Quarto/Markdown documents.
//
// POST /api/xref/index   body: { file?: string }          → XRefs
// POST /api/xref/forId   body: { file: string, id: string } → XRefs
//
// Scans all .qmd and .md files under `pages/` and extracts Quarto cross-reference
// labels (figures, tables, sections, equations, listings, theorem-like envs).
//
// XRef shape mirrors `editor-types/XRef`:
//   { file: string, type: string, id: string, suffix: string, title?: string }
// where `type` is the prefix before the first dash in the label, e.g.
//   label `fig-myplot` → type=`fig`, id=`myplot`

import type { Express, Request, Response } from 'express';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import type { ServerContext } from '../context.js';
import { badRequest } from '../utils/errorResponse.js';

// ── XRef types ────────────────────────────────────────────────────────────────

export interface XRef {
  /** File path relative to baseDir (forward slashes). */
  file: string;
  /** Quarto xref type prefix: 'fig', 'tbl', 'sec', 'eq', 'lst', etc. */
  type: string;
  /** Identifier WITHOUT the type prefix. e.g. for `fig-myplot`, id = 'myplot'. */
  id: string;
  /** Extra suffix (e.g. '-1' for sub-figures). Usually empty. */
  suffix: string;
  /** Human-readable title / caption where it can be extracted. */
  title?: string;
}

export interface XRefs {
  baseDir: string;
  refs: XRef[];
}

// ── Known Quarto xref type prefixes ──────────────────────────────────────────

const QUARTO_XREF_TYPES = new Set([
  'fig', 'tbl', 'sec', 'eq', 'lst',
  'thm', 'lem', 'cor', 'prp', 'cnj',
  'def', 'exm', 'exr', 'sol', 'rem',
  'tip', 'note', 'caution', 'warning', 'important',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse `type-id` strings like `fig-myplot` into `{ type: 'fig', id: 'myplot' }`.
 * Returns null when the prefix is not a known Quarto xref type.
 */
export function splitTypeId(raw: string): { type: string; id: string } | null {
  const dashIdx = raw.indexOf('-');
  if (dashIdx < 0) return null;
  const type = raw.slice(0, dashIdx);
  const id = raw.slice(dashIdx + 1);
  if (!QUARTO_XREF_TYPES.has(type) || !id) return null;
  return { type, id };
}

// ── Per-file scanner ──────────────────────────────────────────────────────────

/**
 * Scan a single file's contents for cross-reference labels.
 *
 * Patterns recognised:
 *  1. ATX headings     `## My Section {#sec-id}`
 *  2. Div fences       `::: {#fig-xxx}` / `::: {#tbl-xxx}` etc.
 *  3. Code chunk opts  `#| label: fig-xxx` (with optional `#| fig-cap:` lookup)
 *  4. Inline images    `![Cap](path){#fig-xxx}`
 *  5. Equation blocks  `$$ ... $$ {#eq-xxx}` or a bare `{#eq-xxx}` line
 *
 * @param content Raw file contents.
 * @param relPath Path relative to baseDir (forward slashes), included in each ref.
 */
export function scanFileForXRefs(content: string, relPath: string): XRef[] {
  const refs: XRef[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // ── 1. ATX headings: `## My Section {#sec-id}` ───────────────────────────
    const headingMatch = /^#{1,6}\s+(.*?)\s*\{#([\w-]+)[^}]*\}/.exec(line);
    if (headingMatch) {
      const parsed = splitTypeId(headingMatch[2]!);
      if (parsed) {
        const headingTitle = headingMatch[1]!.trim() || undefined;
        refs.push({
          file: relPath,
          type: parsed.type,
          id: parsed.id,
          suffix: '',
          ...(headingTitle !== undefined ? { title: headingTitle } : {}),
        });
        continue;
      }
    }

    // ── 2. Div fences: `::: {#fig-xxx}` ──────────────────────────────────────
    const divMatch = /^:{3,}\s*\{[^}]*#([\w-]+)[^}]*\}/.exec(line);
    if (divMatch) {
      const parsed = splitTypeId(divMatch[1]!);
      if (parsed) {
        // Peek ahead for a caption line (up to 5 lines)
        let title: string | undefined;
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const l = lines[j]!;
          // Explicit `Figure:` / `Table:` caption or bold-wrapped caption
          const cap =
            /^Figure:\s*(.*)/i.exec(l)?.[1] ??
            /^Table:\s*(.*)/i.exec(l)?.[1] ??
            /^\*\*(.*?)\*\*$/.exec(l)?.[1];
          if (cap !== undefined) { title = cap.trim() || undefined; break; }
          if (/^:{3,}/.test(l)) break; // end of enclosing div — stop
        }
        refs.push({ file: relPath, type: parsed.type, id: parsed.id, suffix: '', ...(title !== undefined ? { title } : {}) });
        continue;
      }
    }

    // ── 3. Code chunk options: `#| label: fig-xxx` ───────────────────────────
    const chunkLabelMatch = /^#\|\s+label:\s+([\w-]+)/.exec(line);
    if (chunkLabelMatch) {
      const parsed = splitTypeId(chunkLabelMatch[1]!);
      if (parsed) {
        // Peek ahead for `#| fig-cap:` / `#| tbl-cap:` etc.
        let title: string | undefined;
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          const capMatch = /^#\|\s+(?:fig|tbl|lst)-cap:\s+(.*)/.exec(lines[j]!);
          if (capMatch) {
            title = capMatch[1]!.trim().replace(/^["']|["']$/g, '') || undefined;
            break;
          }
          if (!lines[j]!.startsWith('#|')) break; // exited chunk options block
        }
        refs.push({ file: relPath, type: parsed.type, id: parsed.id, suffix: '', ...(title !== undefined ? { title } : {}) });
        continue;
      }
    }

    // ── 4. Inline images: `![Cap](path){#fig-xxx}` ───────────────────────────
    const imgRe = /!\[([^\]]*)\]\([^)]*\)\{[^}]*#([\w-]+)[^}]*\}/g;
    let imgMatch: RegExpExecArray | null;
    let foundImg = false;
    while ((imgMatch = imgRe.exec(line)) !== null) {
      const parsed = splitTypeId(imgMatch[2]!);
      if (parsed) {
        refs.push({
          file: relPath,
          type: parsed.type,
          id: parsed.id,
          suffix: '',
          ...(imgMatch[1]! ? { title: imgMatch[1] } : {}),
        });
        foundImg = true;
      }
    }
    if (foundImg) continue;

    // ── 5. Equation labels: `$$ ... $$ {#eq-xxx}` or bare `{#eq-xxx}` ────────
    const eqMatch =
      /\$\$[^$]*\$\$\s*\{#(eq-[\w-]+)\}/.exec(line) ??
      /^\s*\{#(eq-[\w-]+)\}/.exec(line);
    if (eqMatch) {
      const parsed = splitTypeId(eqMatch[1]!);
      if (parsed) {
        refs.push({ file: relPath, type: parsed.type, id: parsed.id, suffix: '' });
        continue;
      }
    }
  }

  return refs;
}

// ── Project-wide scan ─────────────────────────────────────────────────────────

/** Recursively collect .qmd and .md file paths under `dir`. */
export function walkFiles(dir: string): string[] {
  const result: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          result.push(...walkFiles(full));
        } else if (st.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (ext === '.qmd' || ext === '.md') result.push(full);
        }
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* skip unreadable dirs */ }
  return result;
}

/**
 * Scan all Quarto/Markdown files under `pagesDir` for cross-reference labels.
 *
 * @param pagesDir Absolute path to the pages directory (used as `baseDir`).
 */
export function scanXRefsInProject(pagesDir: string): XRefs {
  const files = walkFiles(pagesDir);
  const refs: XRef[] = [];

  for (const absPath of files) {
    try {
      const content = readFileSync(absPath, 'utf-8');
      const relPath = relative(pagesDir, absPath).replace(/\\/g, '/');
      refs.push(...scanFileForXRefs(content, relPath));
    } catch { /* skip unreadable files */ }
  }

  return { baseDir: pagesDir, refs };
}

// ── Route registration ────────────────────────────────────────────────────────

// ── XRefManager class ─────────────────────────────────────────────────────────

/** Encapsulates the XRef cache and its dirty-flag invalidation logic. */
export class XRefManager {
  private cache: XRefs | null = null;
  /** Starts dirty so the first call always performs a full scan. */
  private dirty = true;

  markDirty(): void { this.dirty = true; }

  reset(): void { this.cache = null; this.dirty = true; }

  getCache(): XRefs | null { return this.cache; }

  /** Scan XRefs using a watcher-driven dirty flag instead of per-file stat calls. */
  scan(pagesDir: string): XRefs {
    if (!this.dirty && this.cache !== null) {
      return this.cache;
    }
    const files = walkFiles(pagesDir);
    const refs: XRef[] = [];
    for (const absPath of files) {
      try {
        const content = readFileSync(absPath, 'utf-8');
        const relPath = relative(pagesDir, absPath).replace(/\\/g, '/');
        refs.push(...scanFileForXRefs(content, relPath));
      } catch { /* skip unreadable */ }
    }
    this.cache = { baseDir: pagesDir, refs };
    this.dirty = false;
    return this.cache;
  }
}

/** Factory — creates a fresh, isolated XRefManager instance. */
export function createXRefManager(): XRefManager { return new XRefManager(); }

// Module-level singleton used by the server and the backward-compat helpers below.
const _defaultXrefManager = createXRefManager();

// ── Backward-compat exports ───────────────────────────────────────────────────

/**
 * Mark the XRef cache as stale. Call this whenever a .qmd file is added,
 * changed, or deleted (e.g. from the file watcher).
 */
export function markXRefCacheDirty(): void {
  _defaultXrefManager.markDirty();
}

/** Reset the cache — intended for use in tests only */
export function resetXrefCache(): void {
  _defaultXrefManager.reset();
}

/** Get the current XRef cache value — for use in tests only. */
export function getXRefCache(): XRefs | null { return _defaultXrefManager.getCache(); }

export function registerXRefApi(app: Express, ctx: ServerContext): void {
  const pagesDir = join(ctx.cwd, ctx.config.pages_dir);
  // Use injected instance from context if provided (enables test isolation),
  // otherwise fall back to the module-level singleton.
  const xm = ctx.xrefManager ?? _defaultXrefManager;

  /**
   * POST /api/xref/index
   * Body: { file?: string }
   * Returns XRefs (full project scan; file is currently unused but reserved).
   */
  app.post('/api/xref/index', (req: Request, res: Response) => {
    void req.body; // file hint ignored — always scans full project
    res.json(xm.scan(pagesDir));
  });

  /**
   * POST /api/xref/forId
   * Body: { file?: string, id: string }  — id format: "type-rest", e.g. "fig-myplot"
   * Returns XRefs filtered to that specific id.
   */
  app.post('/api/xref/forId', (req: Request, res: Response) => {
    const { id } = req.body as { id?: string };
    if (!id) return badRequest(res, 'id is required');

    const index = xm.scan(pagesDir);
    const matchingRefs = index.refs.filter(r => `${r.type}-${r.id}${r.suffix}` === id);
    res.json({ ...index, refs: matchingRefs });
  });
}
