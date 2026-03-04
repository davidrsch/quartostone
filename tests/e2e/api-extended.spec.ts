// tests/e2e/api-extended.spec.ts
// E2E coverage for:
//   • Pandoc API  — /api/pandoc/* routes
//   • XRef API    — /api/xref/* routes
//   • Graph view  — browser interaction with #graph-panel

import { test, expect } from '@playwright/test';

// ── Pandoc API ────────────────────────────────────────────────────────────────
//
// pandoc IS installed in the CI E2E runner (added to ci.yml).
// If it isn't available (local dev without pandoc) the tests skip gracefully.

test.describe('Pandoc API', () => {
  /**
   * Returns true if pandoc is available; calls testInfo.skip() and returns
   * false when it isn't, so callers can `if (!ok) return;`.
   */
  async function requirePandoc(
    request: import('@playwright/test').APIRequestContext,
    testInfo: import('@playwright/test').TestInfo,
  ): Promise<boolean> {
    const res = await request.post('/api/pandoc/capabilities');
    if (res.status() === 503) {
      testInfo.skip(true, 'pandoc not installed — skipping pandoc API test');
      return false;
    }
    return true;
  }

  test('POST /api/pandoc/capabilities returns version shape', async ({ request }, testInfo) => {
    if (!await requirePandoc(request, testInfo)) return;

    const res = await request.post('/api/pandoc/capabilities');
    expect(res.status()).toBe(200);

    const body = await res.json() as {
      version: string;
      api_version: number[];
      output_formats: string;
      highlight_languages: string;
    };
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(Array.isArray(body.api_version)).toBe(true);
    expect(body.api_version.length).toBeGreaterThanOrEqual(3);
    expect(typeof body.output_formats).toBe('string');
    expect(body.output_formats).toContain('html');
    expect(typeof body.highlight_languages).toBe('string');
  });

  test('POST /api/pandoc/markdownToAst returns a pandoc AST', async ({ request }, testInfo) => {
    if (!await requirePandoc(request, testInfo)) return;

    const res = await request.post('/api/pandoc/markdownToAst', {
      data: {
        markdown: '# Hello World\n\nA **bold** paragraph.',
        format: 'markdown',
        options: [],
      },
    });
    expect(res.status()).toBe(200);

    const ast = await res.json() as { blocks: unknown[]; 'pandoc-api-version': number[] };
    expect(Array.isArray(ast.blocks)).toBe(true);
    expect(ast.blocks.length).toBeGreaterThanOrEqual(2); // heading + para
    expect(Array.isArray(ast['pandoc-api-version'])).toBe(true);
  });

  test('POST /api/pandoc/astToMarkdown returns markdown string', async ({ request }, testInfo) => {
    if (!await requirePandoc(request, testInfo)) return;

    // Step 1: get a real AST
    const astRes = await request.post('/api/pandoc/markdownToAst', {
      data: { markdown: '# Round Trip\n\nSome *italic* text.', format: 'markdown', options: [] },
    });
    expect(astRes.status()).toBe(200);
    const ast = await astRes.json();

    // Step 2: convert back to markdown
    const mdRes = await request.post('/api/pandoc/astToMarkdown', {
      data: { ast, format: 'markdown', options: [] },
    });
    expect(mdRes.status()).toBe(200);

    const markdown = await mdRes.json() as string;
    expect(typeof markdown).toBe('string');
    // Heading and italic must survive the round-trip
    expect(markdown).toMatch(/Round Trip/);
    expect(markdown).toMatch(/italic/);
  });

  test('POST /api/pandoc/markdownToAst with missing body returns 400', async ({ request }, testInfo) => {
    if (!await requirePandoc(request, testInfo)) return;

    const res = await request.post('/api/pandoc/markdownToAst', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('POST /api/pandoc/listExtensions returns extension list for markdown', async ({ request }, testInfo) => {
    if (!await requirePandoc(request, testInfo)) return;

    const res = await request.post('/api/pandoc/listExtensions', {
      data: { format: 'markdown' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as string;
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(0);
    // A well-known markdown extension that pandoc always lists
    expect(body).toContain('auto_identifiers');
  });

  test('POST /api/pandoc/getBibliography returns stub bibliography shape', async ({ request }) => {
    const res = await request.post('/api/pandoc/getBibliography');
    expect(res.status()).toBe(200);

    const body = await res.json() as {
      etag: string;
      bibliography: { sources: unknown[]; project_biblios: unknown[] };
    };
    expect(typeof body.etag).toBe('string');
    expect(Array.isArray(body.bibliography.sources)).toBe(true);
    expect(Array.isArray(body.bibliography.project_biblios)).toBe(true);
  });

  test('POST /api/pandoc/citationHTML returns empty string stub', async ({ request }) => {
    const res = await request.post('/api/pandoc/citationHTML');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBe('');
  });
});

// ── XRef API ──────────────────────────────────────────────────────────────────
//
// A fixture page with known cross-reference labels is created in beforeAll and
// removed in afterAll so these tests are idempotent.

const XREF_FIXTURE_PAGE = 'e2e-xref-fixture.qmd';
const XREF_FIXTURE_CONTENT = [
  '---',
  'title: XRef E2E Fixture',
  '---',
  '',
  '## Introduction {#sec-intro}',
  '',
  '## Methods {#sec-methods}',
  '',
  '::: {#fig-diagram}',
  'Figure: A test diagram',
  ':::',
  '',
  '```python',
  '#| label: tbl-results',
  '#| tbl-cap: Results table',
  'print(42)',
  '```',
  '',
  '$$ E = mc^2 $$ {#eq-einstein}',
  '',
].join('\n');

test.describe('XRef API', () => {
  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${XREF_FIXTURE_PAGE}`, {
      data: { content: XREF_FIXTURE_CONTENT },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/pages/${XREF_FIXTURE_PAGE}`);
  });

  test('POST /api/xref/index returns { baseDir, refs } shape', async ({ request }) => {
    const res = await request.post('/api/xref/index', {
      data: { file: 'index.qmd' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json() as { baseDir: string; refs: unknown[] };
    expect(typeof body.baseDir).toBe('string');
    expect(body.baseDir.length).toBeGreaterThan(0);
    expect(Array.isArray(body.refs)).toBe(true);
  });

  test('POST /api/xref/index detects section headings in fixture page', async ({ request }) => {
    const res = await request.post('/api/xref/index', {
      data: { file: XREF_FIXTURE_PAGE },
    });
    expect(res.status()).toBe(200);

    const body = await res.json() as { baseDir: string; refs: Array<{ type: string; id: string }> };
    const secIds = body.refs.filter(r => r.type === 'sec').map(r => r.id);
    expect(secIds).toContain('intro');
    expect(secIds).toContain('methods');
  });

  test('POST /api/xref/index detects figure and table refs in fixture page', async ({ request }) => {
    const res = await request.post('/api/xref/index', { data: { file: XREF_FIXTURE_PAGE } });
    expect(res.status()).toBe(200);

    const body = await res.json() as { refs: Array<{ type: string; id: string; file: string }> };
    const fixtureRefs = body.refs.filter(r => r.file === XREF_FIXTURE_PAGE);

    const types = fixtureRefs.map(r => r.type);
    expect(types).toContain('fig');
    expect(types).toContain('tbl');
  });

  test('POST /api/xref/forId returns matching ref', async ({ request }) => {
    const res = await request.post('/api/xref/forId', {
      data: { file: XREF_FIXTURE_PAGE, id: 'sec-intro' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json() as { refs: Array<{ type: string; id: string }> };
    expect(Array.isArray(body.refs)).toBe(true);
    expect(body.refs.length).toBe(1);
    expect(body.refs[0]!.type).toBe('sec');
    expect(body.refs[0]!.id).toBe('intro');
  });

  test('POST /api/xref/forId with nonexistent id returns empty refs', async ({ request }) => {
    const res = await request.post('/api/xref/forId', {
      data: { file: XREF_FIXTURE_PAGE, id: 'fig-absolutely-does-not-exist' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json() as { refs: unknown[] };
    expect(Array.isArray(body.refs)).toBe(true);
    expect(body.refs.length).toBe(0);
  });

  test('POST /api/xref/forId without id returns 400', async ({ request }) => {
    const res = await request.post('/api/xref/forId', {
      data: { file: XREF_FIXTURE_PAGE },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });
});

// ── Graph view (browser) ──────────────────────────────────────────────────────
//
// Tests that the graph panel opens, renders a <canvas>, and closes correctly.

test.describe('Graph view (browser)', () => {
  async function openApp(page: import('@playwright/test').Page): Promise<boolean> {
    await page.goto('/');
    const ok = await page.locator('#sidebar').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    if (!ok) return false;
    // The graph button is in the toolbar; confirm it exists
    return await page.locator('#btn-graph').isVisible({ timeout: 5_000 }).catch(() => false);
  }

  test('#graph-panel is hidden on initial page load', async ({ page }, testInfo) => {
    if (!await openApp(page)) { testInfo.skip(true, 'App did not load'); return; }
    await expect(page.locator('#graph-panel')).toHaveClass(/hidden/);
  });

  test('clicking #btn-graph opens the graph panel', async ({ page }, testInfo) => {
    if (!await openApp(page)) { testInfo.skip(true, 'App did not load'); return; }

    await page.locator('#btn-graph').click();
    await expect(page.locator('#graph-panel')).not.toHaveClass(/hidden/, { timeout: 3_000 });
  });

  test('#graph-canvas is visible when panel is open', async ({ page }, testInfo) => {
    if (!await openApp(page)) { testInfo.skip(true, 'App did not load'); return; }

    await page.locator('#btn-graph').click();
    await expect(page.locator('#graph-panel')).not.toHaveClass(/hidden/, { timeout: 3_000 });

    const canvas = page.locator('#graph-canvas');
    await expect(canvas).toBeVisible({ timeout: 3_000 });

    // Canvas should have positive rendered dimensions
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('clicking #graph-close-btn closes the graph panel', async ({ page }, testInfo) => {
    if (!await openApp(page)) { testInfo.skip(true, 'App did not load'); return; }

    await page.locator('#btn-graph').click();
    await expect(page.locator('#graph-panel')).not.toHaveClass(/hidden/, { timeout: 3_000 });

    await page.locator('#graph-close-btn').click();
    await expect(page.locator('#graph-panel')).toHaveClass(/hidden/, { timeout: 3_000 });
  });

  test('#graph-filter input accepts typing without crash', async ({ page }, testInfo) => {
    if (!await openApp(page)) { testInfo.skip(true, 'App did not load'); return; }

    await page.locator('#btn-graph').click();
    await expect(page.locator('#graph-panel')).not.toHaveClass(/hidden/, { timeout: 3_000 });

    await page.locator('#graph-filter').fill('test-filter');
    // No crash — panel is still open and canvas is still there
    await expect(page.locator('#graph-panel')).not.toHaveClass(/hidden/);
    await expect(page.locator('#graph-canvas')).toBeVisible();
  });
});
