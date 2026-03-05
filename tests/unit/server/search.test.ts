// tests/unit/server/search.test.ts
// Unit tests for the full-text search index and search API routes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';
import {
  index,
  search,
  rebuildSearchIndex,
  updateSearchIndexForFile,
  removeSearchIndexForFile,
} from '../../../src/server/api/search.js';

// ── Standard config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: QuartostoneConfig = {
  commit_mode: 'prompt',
  commit_message_auto: 'qs-{alphanum8}',
  render_on_save: false,
  render_scope: 'file',
  watch_interval_ms: 300,
  port: 0,
  pages_dir: 'pages',
  open_browser: false,
  allow_code_execution: false,
};

let workspace: string;
let client: ReturnType<typeof supertest>;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-search-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@t.com"', { cwd: workspace });
  execSync('git config user.name "test"', { cwd: workspace });

  index.clear();

  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  index.clear();
});

// ── search() pure function ────────────────────────────────────────────────────

describe('search()', () => {
  beforeEach(() => {
    writeFileSync(
      join(workspace, 'pages', 'quarto.qmd'),
      '---\ntitle: Quarto Guide\n---\n\nLearn how to use Quarto for publishing.\n',
    );
    writeFileSync(
      join(workspace, 'pages', 'python.qmd'),
      '---\ntitle: Python Basics\n---\n\nIntroduction to Python programming language.\n',
    );
    rebuildSearchIndex(join(workspace, 'pages'));
  });

  it('returns empty array for empty query', () => {
    expect(search('')).toEqual([]);
    expect(search('   ')).toEqual([]);
  });

  it('returns results for a matching query', () => {
    const results = search('quarto');
    expect(results.length).toBeGreaterThan(0);
    const paths = results.map(r => r.path);
    expect(paths).toContain('quarto.qmd');
  });

  it('title matches score higher than body-only matches', () => {
    // "Quarto" appears in title of quarto.qmd; "publishing" only in body
    const titleResults = search('quarto');
    const bodyResults  = search('publishing');

    const titleResult = titleResults.find(r => r.path === 'quarto.qmd')!;
    const bodyResult  = bodyResults.find(r => r.path === 'quarto.qmd')!;

    expect(titleResult).toBeDefined();
    expect(bodyResult).toBeDefined();
    expect(titleResult.score).toBeGreaterThan(bodyResult.score);
  });

  it('does not return unrelated pages', () => {
    const results = search('python');
    const paths = results.map(r => r.path);
    expect(paths).toContain('python.qmd');
    expect(paths).not.toContain('quarto.qmd');
  });

  it('each result has path, title, excerpt, score fields', () => {
    const results = search('learn');
    expect(results.length).toBeGreaterThan(0);
    const r = results[0]!;
    expect(r).toHaveProperty('path');
    expect(r).toHaveProperty('title');
    expect(r).toHaveProperty('excerpt');
    expect(r).toHaveProperty('score');
    expect(r.score).toBeGreaterThan(0);
  });

  it('returns at most 20 results', () => {
    // Create 25 pages each mentioning "needle"
    for (let i = 0; i < 25; i++) {
      writeFileSync(
        join(workspace, 'pages', `p${i}.qmd`),
        `---\ntitle: Page ${i}\n---\n\nThis page mentions the needle keyword.\n`,
      );
    }
    rebuildSearchIndex(join(workspace, 'pages'));
    const results = search('needle');
    expect(results.length).toBeLessThanOrEqual(20);
  });
});

// ── Body text stripping (via index .body) ─────────────────────────────────────

describe('index body stripping', () => {
  it('strips YAML front-matter from body', () => {
    writeFileSync(
      join(workspace, 'pages', 'fm.qmd'),
      '---\ntitle: FM Page\nauthor: Alice\n---\n\nActual content here.\n',
    );
    rebuildSearchIndex(join(workspace, 'pages'));

    const entry = index.get('fm.qmd');
    expect(entry).toBeDefined();
    expect(entry!.body).not.toContain('author: Alice');
    expect(entry!.body).toContain('Actual content here');
  });

  it('strips markdown headings from body', () => {
    writeFileSync(
      join(workspace, 'pages', 'headings.qmd'),
      '---\ntitle: H\n---\n\n## Section Heading\n\nBody text only.\n',
    );
    rebuildSearchIndex(join(workspace, 'pages'));

    const entry = index.get('headings.qmd');
    expect(entry!.body).not.toMatch(/^##/m);
    expect(entry!.body).toContain('Section Heading');
  });

  it('replaces wiki link syntax with display text', () => {
    writeFileSync(
      join(workspace, 'pages', 'wiki.qmd'),
      '---\ntitle: W\n---\n\nSee [[Target Page]] for details.\n',
    );
    rebuildSearchIndex(join(workspace, 'pages'));

    const entry = index.get('wiki.qmd');
    expect(entry!.body).not.toContain('[[');
    expect(entry!.body).toContain('Target Page');
  });

  it('strips code fence blocks', () => {
    writeFileSync(
      join(workspace, 'pages', 'code.qmd'),
      '---\ntitle: Code\n---\n\nSome text.\n\n```python\nprint("hello")\n```\n\nMore text.\n',
    );
    rebuildSearchIndex(join(workspace, 'pages'));

    const entry = index.get('code.qmd');
    expect(entry!.body).not.toContain('print("hello")');
    expect(entry!.body).toContain('Some text');
  });
});

// ── GET /api/search ───────────────────────────────────────────────────────────

describe('GET /api/search', () => {
  beforeEach(() => {
    writeFileSync(
      join(workspace, 'pages', 'rust.qmd'),
      '---\ntitle: Rust Programming\n---\n\nRust is a systems programming language.\n',
    );
    writeFileSync(
      join(workspace, 'pages', 'go.qmd'),
      '---\ntitle: Go Language\n---\n\nGo is a statically typed language by Google.\n',
    );
    rebuildSearchIndex(join(workspace, 'pages'));
  });

  it('returns empty array for empty/missing query', async () => {
    const res = await client.get('/api/search?q=');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns matching pages for a keyword query', async () => {
    const res = await client.get('/api/search?q=rust');
    expect(res.status).toBe(200);
    const paths = (res.body as { path: string }[]).map(r => r.path);
    expect(paths).toContain('rust.qmd');
    expect(paths).not.toContain('go.qmd');
  });

  it('result items include required fields', async () => {
    const res = await client.get('/api/search?q=language');
    expect(res.status).toBe(200);
    const results = res.body as { path: string; title: string; excerpt: string; score: number }[];
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty('path');
      expect(r).toHaveProperty('title');
      expect(r).toHaveProperty('excerpt');
      expect(r).toHaveProperty('score');
    }
  });

  it('returns results sorted by score descending', async () => {
    const res = await client.get('/api/search?q=language');
    const scores = (res.body as { score: number }[]).map(r => r.score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i + 1]!);
    }
  });
});

// ── POST /api/search/reindex ──────────────────────────────────────────────────

describe('POST /api/search/reindex', () => {
  it('returns { ok: true, indexed: N } and rebuilds the index', async () => {
    writeFileSync(
      join(workspace, 'pages', 'a.qmd'),
      '---\ntitle: A\n---\n\nContent A.\n',
    );
    writeFileSync(
      join(workspace, 'pages', 'b.qmd'),
      '---\ntitle: B\n---\n\nContent B.\n',
    );
    index.clear(); // simulate empty state

    const res = await client.post('/api/search/reindex');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(typeof res.body.indexed).toBe('number');
    expect(res.body.indexed).toBeGreaterThanOrEqual(2);
  });
});

// ── Index lifecycle helpers ───────────────────────────────────────────────────

describe('rebuildSearchIndex', () => {
  it('populates the index for every .qmd file', () => {
    writeFileSync(join(workspace, 'pages', 'x.qmd'), '---\ntitle: X\n---\nHello X.\n');
    writeFileSync(join(workspace, 'pages', 'y.qmd'), '---\ntitle: Y\n---\nHello Y.\n');
    rebuildSearchIndex(join(workspace, 'pages'));

    expect(index.has('x.qmd')).toBe(true);
    expect(index.has('y.qmd')).toBe(true);
  });

  it('clears the index before rebuilding', () => {
    writeFileSync(join(workspace, 'pages', 'z.qmd'), '---\ntitle: Z\n---\nHello.\n');
    rebuildSearchIndex(join(workspace, 'pages'));
    expect(index.has('z.qmd')).toBe(true);

    rmSync(join(workspace, 'pages', 'z.qmd'));
    rebuildSearchIndex(join(workspace, 'pages'));
    expect(index.has('z.qmd')).toBe(false);
  });

  it('extracts the correct title from front-matter', () => {
    writeFileSync(
      join(workspace, 'pages', 'titled.qmd'),
      '---\ntitle: "My Fancy Title"\n---\n\nBody text.\n',
    );
    rebuildSearchIndex(join(workspace, 'pages'));

    const entry = index.get('titled.qmd');
    expect(entry!.title).toBe('My Fancy Title');
  });
});

describe('updateSearchIndexForFile', () => {
  it('adds a new file to the index without full rebuild', () => {
    rebuildSearchIndex(join(workspace, 'pages'));
    expect(index.size).toBe(0);

    writeFileSync(join(workspace, 'pages', 'fresh.qmd'), '---\ntitle: Fresh\n---\nHello.\n');
    updateSearchIndexForFile(join(workspace, 'pages'), 'fresh.qmd');

    expect(index.has('fresh.qmd')).toBe(true);
    expect(index.get('fresh.qmd')?.title).toBe('Fresh');
  });

  it('updates an existing entry when content changes', () => {
    writeFileSync(
      join(workspace, 'pages', 'chan.qmd'),
      '---\ntitle: Chan\n---\nOriginal content.\n',
    );
    rebuildSearchIndex(join(workspace, 'pages'));
    expect(index.get('chan.qmd')?.body).toContain('Original content');

    writeFileSync(
      join(workspace, 'pages', 'chan.qmd'),
      '---\ntitle: Chan\n---\nCompletely updated content.\n',
    );
    updateSearchIndexForFile(join(workspace, 'pages'), 'chan.qmd');
    expect(index.get('chan.qmd')?.body).toContain('Completely updated content');
  });
});

describe('removeSearchIndexForFile', () => {
  it('removes a file from the index', () => {
    writeFileSync(join(workspace, 'pages', 'gone.qmd'), '---\ntitle: Gone\n---\nBye.\n');
    rebuildSearchIndex(join(workspace, 'pages'));
    expect(index.has('gone.qmd')).toBe(true);

    removeSearchIndexForFile('gone.qmd');
    expect(index.has('gone.qmd')).toBe(false);
  });

  it('search returns no results for terms from a removed file', () => {
    writeFileSync(
      join(workspace, 'pages', 'unique.qmd'),
      '---\ntitle: Unique Content\n---\nUniquetermzyx is only in this file.\n',
    );
    rebuildSearchIndex(join(workspace, 'pages'));
    expect(search('uniquetermzyx').length).toBeGreaterThan(0);

    removeSearchIndexForFile('unique.qmd');
    expect(search('uniquetermzyx')).toEqual([]);
  });
});

// ── updateSearchIndexForFile — incremental updates ────────────────────────────
// Tests focus on the replace-not-accumulate semantics: calling the function
// twice must leave exactly the second version in the index, with no tokens
// carried over from the first.

describe('updateSearchIndexForFile — incremental updates', () => {
  it('adds a file to the search index with correct tokens', () => {
    writeFileSync(
      join(workspace, 'pages', 'novel.qmd'),
      '---\ntitle: Novel Entry\n---\n\nContains the word xyzplankton.\n',
    );

    updateSearchIndexForFile(join(workspace, 'pages'), 'novel.qmd');

    const entry = index.get('novel.qmd');
    expect(entry).toBeDefined();
    expect(entry!.title).toBe('Novel Entry');
    expect(entry!.tokens).toContain('xyzplankton');
  });

  it('replaces existing entry on second call — old tokens are gone', () => {
    // First version contains "firsttoken"
    writeFileSync(
      join(workspace, 'pages', 'replace.qmd'),
      '---\ntitle: Replace\n---\n\nBody with firsttoken here.\n',
    );
    updateSearchIndexForFile(join(workspace, 'pages'), 'replace.qmd');
    expect(index.get('replace.qmd')!.tokens).toContain('firsttoken');

    // Second version replaces "firsttoken" with "secondtoken"
    writeFileSync(
      join(workspace, 'pages', 'replace.qmd'),
      '---\ntitle: Replace\n---\n\nBody with secondtoken instead.\n',
    );
    updateSearchIndexForFile(join(workspace, 'pages'), 'replace.qmd');

    const entry = index.get('replace.qmd')!;
    expect(entry.tokens).toContain('secondtoken');
    // Old token must not be present — no accumulation
    expect(entry.tokens).not.toContain('firsttoken');
  });
});
