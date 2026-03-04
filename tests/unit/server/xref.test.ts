// tests/unit/server/xref.test.ts
// Unit and integration tests for the Quarto cross-reference scanner.
//
// Coverage:
//  • splitTypeId()          — pure function, type/id split
//  • scanFileForXRefs()     — regex scanner on file content strings
//  • scanXRefsInProject()   — file-system walk + multi-file scan
//  • POST /api/xref/index   — HTTP route (via supertest)
//  • POST /api/xref/forId   — HTTP route (via supertest)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';
import {
  splitTypeId,
  scanFileForXRefs,
  scanXRefsInProject,
  walkFiles,
} from '../../../src/server/api/xref.js';

// ── Shared test config + workspace ────────────────────────────────────────────

const DEFAULT_CONFIG: QuartostoneConfig = {
  commit_mode: 'prompt',
  commit_message_auto: 'qs-{alphanum8}',
  render_on_save: false,
  render_scope: 'file',
  watch_interval_ms: 300,
  port: 0,
  pages_dir: 'pages',
  open_browser: false,
};

let workspace: string;
let client: ReturnType<typeof supertest>;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-xref-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@t.com"', { cwd: workspace });
  execSync('git config user.name "test"', { cwd: workspace });
  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── splitTypeId ───────────────────────────────────────────────────────────────

describe('splitTypeId', () => {
  it('correctly splits fig-myplot', () => {
    expect(splitTypeId('fig-myplot')).toEqual({ type: 'fig', id: 'myplot' });
  });

  it('correctly splits sec-intro', () => {
    expect(splitTypeId('sec-intro')).toEqual({ type: 'sec', id: 'intro' });
  });

  it('correctly splits tbl-summary', () => {
    expect(splitTypeId('tbl-summary')).toEqual({ type: 'tbl', id: 'summary' });
  });

  it('correctly splits eq-maxwell', () => {
    expect(splitTypeId('eq-maxwell')).toEqual({ type: 'eq', id: 'maxwell' });
  });

  it('correctly splits thm-fundamental', () => {
    expect(splitTypeId('thm-fundamental')).toEqual({ type: 'thm', id: 'fundamental' });
  });

  it('correctly splits lst-code with compound id', () => {
    expect(splitTypeId('lst-my-code-example')).toEqual({ type: 'lst', id: 'my-code-example' });
  });

  it('returns null for unknown type prefix', () => {
    expect(splitTypeId('xyz-something')).toBeNull();
  });

  it('returns null for a string without a dash', () => {
    expect(splitTypeId('myref')).toBeNull();
  });

  it('returns null for empty id after dash', () => {
    expect(splitTypeId('fig-')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(splitTypeId('')).toBeNull();
  });
});

// ── scanFileForXRefs ──────────────────────────────────────────────────────────

describe('scanFileForXRefs — ATX headings', () => {
  it('extracts a level-2 section heading', () => {
    const content = '## Introduction {#sec-intro}\n\nSome text.\n';
    const refs = scanFileForXRefs(content, 'doc.qmd');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ type: 'sec', id: 'intro', title: 'Introduction', file: 'doc.qmd' });
  });

  it('extracts a level-1 heading', () => {
    const content = '# Overview {#sec-overview}\n';
    const refs = scanFileForXRefs(content, 'index.qmd');
    expect(refs[0]).toMatchObject({ type: 'sec', id: 'overview' });
  });

  it('extracts multiple headings from the same file', () => {
    const content = [
      '# Title',
      '',
      '## Background {#sec-bg}',
      '',
      '## Methods {#sec-methods}',
    ].join('\n');
    const refs = scanFileForXRefs(content, 'paper.qmd');
    expect(refs).toHaveLength(2);
    expect(refs.map(r => r.id)).toEqual(['bg', 'methods']);
  });

  it('does not extract a heading without a label', () => {
    const refs = scanFileForXRefs('## Just a heading\n', 'x.qmd');
    expect(refs).toHaveLength(0);
  });

  it('extracts heading title correctly when brackets contain extra text', () => {
    const content = '## My **Bold** Section {#sec-bold-section}\n';
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs[0]?.type).toBe('sec');
    expect(refs[0]?.id).toBe('bold-section');
  });
});

describe('scanFileForXRefs — div fences', () => {
  it('extracts a figure div label', () => {
    const content = '::: {#fig-myplot}\n\n![A plot](plot.png)\n\n:::\n';
    const refs = scanFileForXRefs(content, 'report.qmd');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ type: 'fig', id: 'myplot' });
  });

  it('extracts a table div label', () => {
    const content = '::: {#tbl-summary}\n\n| A | B |\n\n:::\n';
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs[0]).toMatchObject({ type: 'tbl', id: 'summary' });
  });

  it('picks up Fig explicit caption after div fence', () => {
    const content = '::: {#fig-scatter}\n\nFigure: Scatter plot of results\n\n:::\n';
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs[0]?.title).toBe('Scatter plot of results');
  });

  it('does not bleed caption past the closing fence', () => {
    const content = [
      '::: {#fig-a}',
      ':::',
      '::: {#fig-b}',
      'Figure: Second plot',
      ':::',
    ].join('\n');
    const refs = scanFileForXRefs(content, 'x.qmd');
    // fig-a should have no title (closing fence is next line)
    const a = refs.find(r => r.id === 'a');
    const b = refs.find(r => r.id === 'b');
    expect(a?.title).toBeUndefined();
    expect(b?.title).toBe('Second plot');
  });

  it('extracts theorem div label', () => {
    const content = '::: {#thm-pythagoras}\n\nFor right triangles...\n\n:::\n';
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs[0]).toMatchObject({ type: 'thm', id: 'pythagoras' });
  });
});

describe('scanFileForXRefs — code chunk labels', () => {
  it('extracts a figure code chunk label', () => {
    const content = [
      '```{python}',
      '#| label: fig-boxplot',
      '#| fig-cap: "Distribution of values"',
      'import matplotlib.pyplot as plt',
      'plt.boxplot(data)',
      '```',
    ].join('\n');
    const refs = scanFileForXRefs(content, 'analysis.qmd');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ type: 'fig', id: 'boxplot', title: 'Distribution of values' });
  });

  it('extracts a table code chunk label', () => {
    const content = [
      '```{r}',
      '#| label: tbl-results',
      '#| tbl-cap: Summary table',
      'knitr::kable(df)',
      '```',
    ].join('\n');
    const refs = scanFileForXRefs(content, 'analysis.qmd');
    expect(refs[0]).toMatchObject({ type: 'tbl', id: 'results', title: 'Summary table' });
  });

  it('extracts chunk label without caption', () => {
    const content = [
      '```{python}',
      '#| label: fig-no-cap',
      'plt.plot(x, y)',
      '```',
    ].join('\n');
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs[0]).toMatchObject({ type: 'fig', id: 'no-cap' });
    expect(refs[0]?.title).toBeUndefined();
  });

  it('strips surrounding quotes from caption string', () => {
    const content = '#| label: fig-q\n#| fig-cap: "Quoted caption"\n';
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs[0]?.title).toBe('Quoted caption');
  });

  it('ignores chunk with non-xref label (no type prefix)', () => {
    const content = '#| label: my-chunk\n#| echo: false\n';
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs).toHaveLength(0);
  });
});

describe('scanFileForXRefs — inline images', () => {
  it('extracts a labeled inline image', () => {
    const content = '![A cat](cat.jpg){#fig-cat width=50%}\n';
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ type: 'fig', id: 'cat', title: 'A cat' });
  });

  it('extracts multiple labeled images on the same line', () => {
    const content = '![A](a.png){#fig-a} ![B](b.png){#fig-b}\n';
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs).toHaveLength(2);
    expect(refs.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('ignores unlabeled image', () => {
    const refs = scanFileForXRefs('![A cat](cat.jpg)\n', 'x.qmd');
    expect(refs).toHaveLength(0);
  });
});

describe('scanFileForXRefs — equation labels', () => {
  it('extracts inline equation label on same line', () => {
    const content = '$$E = mc^2$$ {#eq-einstein}\n';
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs[0]).toMatchObject({ type: 'eq', id: 'einstein' });
  });

  it('extracts bare equation label line', () => {
    const content = '$$\nE = mc^2\n$$\n{#eq-energy}\n';
    const refs = scanFileForXRefs(content, 'x.qmd');
    expect(refs[0]).toMatchObject({ type: 'eq', id: 'energy' });
  });
});

describe('scanFileForXRefs — suffix field', () => {
  it('suffix is always empty string in current implementation', () => {
    const refs = scanFileForXRefs('## Section {#sec-test}\n', 'x.qmd');
    expect(refs[0]?.suffix).toBe('');
  });
});

describe('scanFileForXRefs — mixed document', () => {
  it('extracts all xref types from a realistic document', () => {
    const content = [
      '---',
      'title: My Paper',
      '---',
      '',
      '# Overview {#sec-overview}',
      '',
      '## Background {#sec-background}',
      '',
      '::: {#fig-scatter}',
      '![Scatter plot](scatter.png)',
      'Figure: Observations by year',
      ':::',
      '',
      '::: {#tbl-summary}',
      '| Col1 | Col2 |',
      '| ---- | ---- |',
      'Table: Summary statistics',
      ':::',
      '',
      '```{python}',
      '#| label: fig-histogram',
      '#| fig-cap: "Distribution"',
      'plt.hist(data)',
      '```',
      '',
      '$$x^2 + y^2 = r^2$$ {#eq-circle}',
    ].join('\n');

    const refs = scanFileForXRefs(content, 'paper.qmd');

    const types = refs.map(r => r.type);
    expect(types).toContain('sec');
    expect(types).toContain('fig');
    expect(types).toContain('tbl');
    expect(types).toContain('eq');

    expect(refs.find(r => r.id === 'overview')?.title).toBe('Overview');
    expect(refs.find(r => r.id === 'scatter')?.title).toBe('Observations by year');
    expect(refs.find(r => r.id === 'histogram')?.title).toBe('Distribution');
    expect(refs.find(r => r.type === 'eq')?.id).toBe('circle');
  });
});

// ── walkFiles ─────────────────────────────────────────────────────────────────

describe('walkFiles', () => {
  it('returns .qmd files', () => {
    writeFileSync(join(workspace, 'pages', 'a.qmd'), '');
    const files = walkFiles(join(workspace, 'pages'));
    expect(files.some(f => f.endsWith('a.qmd'))).toBe(true);
  });

  it('returns .md files', () => {
    writeFileSync(join(workspace, 'pages', 'b.md'), '');
    const files = walkFiles(join(workspace, 'pages'));
    expect(files.some(f => f.endsWith('b.md'))).toBe(true);
  });

  it('excludes non-markdown files', () => {
    writeFileSync(join(workspace, 'pages', 'style.css'), '');
    const files = walkFiles(join(workspace, 'pages'));
    expect(files.some(f => f.endsWith('.css'))).toBe(false);
  });

  it('recurses into subdirectories', () => {
    mkdirSync(join(workspace, 'pages', 'sub'));
    writeFileSync(join(workspace, 'pages', 'sub', 'nested.qmd'), '');
    const files = walkFiles(join(workspace, 'pages'));
    expect(files.some(f => f.includes('nested.qmd'))).toBe(true);
  });

  it('returns empty array for empty directory', () => {
    const files = walkFiles(join(workspace, 'pages'));
    expect(files).toHaveLength(0);
  });

  it('returns empty array for nonexistent directory', () => {
    const files = walkFiles(join(workspace, 'no-such-dir'));
    expect(files).toHaveLength(0);
  });
});

// ── scanXRefsInProject ────────────────────────────────────────────────────────

describe('scanXRefsInProject', () => {
  it('returns empty refs for an empty project', () => {
    const result = scanXRefsInProject(join(workspace, 'pages'));
    expect(result.refs).toHaveLength(0);
  });

  it('returns refs from a single file', () => {
    writeFileSync(
      join(workspace, 'pages', 'index.qmd'),
      '## Introduction {#sec-intro}\n'
    );
    const result = scanXRefsInProject(join(workspace, 'pages'));
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0]).toMatchObject({ type: 'sec', id: 'intro', file: 'index.qmd' });
  });

  it('aggregates refs from multiple files', () => {
    writeFileSync(join(workspace, 'pages', 'a.qmd'), '::: {#fig-plotA}\n:::\n');
    writeFileSync(join(workspace, 'pages', 'b.qmd'), '::: {#fig-plotB}\n:::\n');
    const result = scanXRefsInProject(join(workspace, 'pages'));
    expect(result.refs).toHaveLength(2);
    expect(result.refs.map(r => r.id).sort()).toEqual(['plotA', 'plotB']);
  });

  it('includes files in subdirectories', () => {
    mkdirSync(join(workspace, 'pages', 'chapter1'));
    writeFileSync(join(workspace, 'pages', 'chapter1', 'methods.qmd'), '## Methods {#sec-methods}\n');
    const result = scanXRefsInProject(join(workspace, 'pages'));
    const ref = result.refs.find(r => r.id === 'methods');
    expect(ref).toBeDefined();
    expect(ref?.file).toBe('chapter1/methods.qmd');
  });

  it('sets baseDir to pagesDir', () => {
    const pagesDir = join(workspace, 'pages');
    const result = scanXRefsInProject(pagesDir);
    expect(result.baseDir).toBe(pagesDir);
  });
});

// ── HTTP Routes ───────────────────────────────────────────────────────────────

describe('POST /api/xref/index', () => {
  it('returns 200 with empty refs for an empty project', async () => {
    const res = await client.post('/api/xref/index').send({});
    expect(res.status).toBe(200);
    const body = res.body as { baseDir: string; refs: unknown[] };
    expect(Array.isArray(body.refs)).toBe(true);
    expect(body.refs).toHaveLength(0);
  });

  it('returns refs when pages contain xref labels', async () => {
    writeFileSync(
      join(workspace, 'pages', 'paper.qmd'),
      '## Results {#sec-results}\n\n::: {#fig-main}\n:::\n'
    );

    const res = await client.post('/api/xref/index').send({});
    expect(res.status).toBe(200);
    const body = res.body as { refs: Array<{ type: string; id: string }> };
    expect(body.refs.some(r => r.type === 'sec' && r.id === 'results')).toBe(true);
    expect(body.refs.some(r => r.type === 'fig' && r.id === 'main')).toBe(true);
  });

  it('ignores a file path hint and scans full project', async () => {
    writeFileSync(join(workspace, 'pages', 'x.qmd'), '::: {#fig-x}\n:::\n');
    const res = await client.post('/api/xref/index').send({ file: 'pages/other.qmd' });
    const body = res.body as { refs: Array<{ id: string }> };
    expect(body.refs.some(r => r.id === 'x')).toBe(true);
  });
});

describe('POST /api/xref/forId', () => {
  it('returns 400 when id is missing', async () => {
    const res = await client.post('/api/xref/forId').send({});
    expect(res.status).toBe(400);
  });

  it('returns only the ref matching the given id', async () => {
    writeFileSync(
      join(workspace, 'pages', 'paper.qmd'),
      '::: {#fig-alpha}\n:::\n::: {#fig-beta}\n:::\n'
    );

    const res = await client.post('/api/xref/forId').send({ id: 'fig-alpha' });
    expect(res.status).toBe(200);
    const body = res.body as { refs: Array<{ type: string; id: string }> };
    expect(body.refs).toHaveLength(1);
    expect(body.refs[0]).toMatchObject({ type: 'fig', id: 'alpha' });
  });

  it('returns empty refs array when id does not match anything', async () => {
    writeFileSync(join(workspace, 'pages', 'paper.qmd'), '::: {#fig-alpha}\n:::\n');
    const res = await client.post('/api/xref/forId').send({ id: 'fig-missing' });
    expect(res.status).toBe(200);
    const body = res.body as { refs: unknown[] };
    expect(body.refs).toHaveLength(0);
  });
});
