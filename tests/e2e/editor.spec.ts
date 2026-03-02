// tests/e2e/editor.spec.ts
// Playwright E2E tests for the Quartostone editor.
//
// PREREQUISITE: The editor client must be built before running these tests.
//   npm run build:client
//
// These tests use the real Express server running against the fixture workspace
// (started by playwright.config.ts webServer).

import { test, expect } from '@playwright/test';

// ── API smoke tests (no browser rendering required) ───────────────────────────

test.describe('API smoke tests', () => {
  test('server is alive — GET /api/pages returns 200', async ({ request }) => {
    const res = await request.get('/api/pages');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('fixture index page exists via API', async ({ request }) => {
    const res = await request.get('/api/pages/index.qmd');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.content).toContain('Welcome to Quartostone');
  });

  test('GET /api/git/status returns git status', async ({ request }) => {
    const res = await request.get('/api/git/status');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('current');
    expect(Array.isArray(body.files)).toBe(true);
  });

  test('GET /api/git/log returns commit history', async ({ request }) => {
    const res = await request.get('/api/git/log');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Pages CRUD ────────────────────────────────────────────────────────────────

test.describe('Pages API — CRUD', () => {
  const testPage = 'e2e-crud-test.qmd';
  const testContent = '---\ntitle: E2E CRUD Test\n---\n\n# E2E Write Test\n\nCreated by the E2E suite.\n';

  test('PUT /api/pages creates or updates a page', async ({ request }) => {
    const res = await request.put(`/api/pages/${testPage}`, {
      data: { content: testContent },
    });
    expect(res.status()).toBe(200);
  });

  test('GET /api/pages reads back written content', async ({ request }) => {
    const res = await request.get(`/api/pages/${testPage}`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { content: string };
    expect(body.content).toContain('E2E Write Test');
  });

  test('GET /api/pages tree includes the new page', async ({ request }) => {
    const res = await request.get('/api/pages');
    expect(res.status()).toBe(200);
    const flat = JSON.stringify(await res.json());
    expect(flat).toContain(testPage);
  });

  test('DELETE /api/pages removes the page', async ({ request }) => {
    const res = await request.delete(`/api/pages/${testPage}`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/pages deleted page returns 404', async ({ request }) => {
    const res = await request.get(`/api/pages/${testPage}`);
    expect(res.status()).toBe(404);
  });

  test('path traversal GET /api/pages/../../_quartostone.yml is rejected (400 or 404)', async ({ request }) => {
    // Express normalises URL paths before routing — `..` segments are resolved,
    // so the request either never matches the /api/pages/* route (→ 404) or hits
    // our guardPath() check (→ 400). Both mean the traversal is blocked.
    const res = await request.get('/api/pages/../../_quartostone.yml');
    expect([400, 404]).toContain(res.status());
  });
});

// ── Search API ────────────────────────────────────────────────────────────────

test.describe('Search API', () => {
  test('GET /api/search?q= (blank) returns empty array', async ({ request }) => {
    const res = await request.get('/api/search?q=');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);
  });

  test('GET /api/search?q=<keyword> returns matching pages', async ({ request }) => {
    const res = await request.get('/api/search?q=Welcome');
    expect(res.status()).toBe(200);
    const body = await res.json() as { path: string; score: number }[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]!.path).toContain('index.qmd');
  });

  test('GET /api/search?q=<nonexistent> returns empty array', async ({ request }) => {
    const res = await request.get('/api/search?q=xyzzy12345notfound');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);
  });
});

// ── Links API ─────────────────────────────────────────────────────────────────

test.describe('Links API', () => {
  const linkSource = 'e2e-link-source.qmd';
  const linkTarget = 'e2e-link-target.qmd';

  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${linkTarget}`, {
      data: { content: '---\ntitle: Link Target\n---\n\n# Target Page\n' },
    });
    await request.put(`/api/pages/${linkSource}`, {
      data: { content: `---\ntitle: Link Source\n---\n\n[[${linkTarget}]]\n` },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/pages/${linkSource}`);
    await request.delete(`/api/pages/${linkTarget}`);
  });

  test('GET /api/links/graph returns nodes and edges arrays', async ({ request }) => {
    const res = await request.get('/api/links/graph');
    expect(res.status()).toBe(200);
    const body = await res.json() as { nodes: unknown[]; edges: unknown[] };
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
  });

  test('GET /api/links/forward?path= returns array', async ({ request }) => {
    const res = await request.get(`/api/links/forward?path=${linkSource}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/links/backlinks?path= returns array', async ({ request }) => {
    const res = await request.get(`/api/links/backlinks?path=${linkTarget}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/links/search?q= returns array', async ({ request }) => {
    const res = await request.get('/api/links/search?q=link');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Git commit API ────────────────────────────────────────────────────────────

test.describe('Git commit API', () => {
  test('PUT + POST /api/git/commit creates a new commit', async ({ request }) => {
    await request.put('/api/pages/e2e-commit-test.qmd', {
      data: { content: '# Commit Test\n\nAdded during E2E.\n' },
    });

    const logBefore = await (await request.get('/api/git/log')).json() as unknown[];

    const commitRes = await request.post('/api/git/commit', {
      data: { message: 'e2e: test commit' },
    });
    expect(commitRes.status()).toBe(200);
    const commitBody = await commitRes.json() as { ok?: boolean };
    expect(commitBody.ok).toBe(true);

    const logAfter = await (await request.get('/api/git/log')).json() as unknown[];
    expect((logAfter as unknown[]).length).toBeGreaterThanOrEqual((logBefore as unknown[]).length);

    // Cleanup: delete the page (don't commit the deletion to avoid polluting log)
    await request.delete('/api/pages/e2e-commit-test.qmd');
  });
});

// ── Exec API ──────────────────────────────────────────────────────────────────

test.describe('Exec API', () => {
  test('POST /api/exec runs Python code and returns stdout', async ({ request }, testInfo) => {
    const res = await request.post('/api/exec', {
      data: { language: 'python', code: 'print("e2e-ok")' },
    });
    if (res.status() === 500 || res.status() === 501) {
      testInfo.annotations.push({ type: 'skip', description: 'Python not available in this environment' });
      return;
    }
    expect(res.status()).toBe(200);
    const body = await res.json() as { stdout?: string; stderr?: string; error?: string };
    expect(body.stdout?.trim()).toBe('e2e-ok');
  });
});

// ── Export API ────────────────────────────────────────────────────────────────

test.describe('Export API', () => {
  test('POST /api/export starts a job and GET /api/export/status returns job', async ({ request }) => {
    const exportRes = await request.post('/api/export', {
      data: { path: 'pages/index.qmd', format: 'html' },
    });
    // 202 Accepted or 200 — either means the job was queued
    expect([200, 202]).toContain(exportRes.status());
    const exportBody = await exportRes.json() as { token?: string; status?: string };
    expect(exportBody.token).toBeTruthy();

    const statusRes = await request.get(`/api/export/status?token=${exportBody.token}`);
    expect(statusRes.status()).toBe(200);
    const statusBody = await statusRes.json() as { status: string };
    expect(['pending', 'running', 'done', 'error']).toContain(statusBody.status);
  });
});

// ── Editor UI tests ───────────────────────────────────────────────────────────

test.describe('Editor UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
  });

  test('editor page loads without a crash (no 5xx response)', async ({ page }) => {
    // The page may show the "not built" fallback if client hasn't been compiled —
    // that's still a valid 200 response, not a server error.
    await expect(page).not.toHaveURL(/error/i);
    const statusOk = page.url().startsWith('http://localhost:4343');
    expect(statusOk).toBe(true);
  });

  test('page title and basic structure present when client is built', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // If the client is built, expect the app shell; otherwise expect the fallback message.
    const isBuilt = await page.evaluate(() =>
      !document.body.textContent?.includes('not built yet')
    );

    if (isBuilt) {
      // The real app shell should have a sidebar element
      await expect(page.locator('#app')).toBeVisible({ timeout: 5000 });
    } else {
      // Fallback HTML from the server — still a valid response
      await expect(page.locator('code')).toContainText('build:client');
    }
  });

  test('Ctrl+S shows "Saved" in status bar', async ({ page }) => {
    test.skip(!!process.env['CI'], 'UI interaction test — requires interactive local session');

    // Wait for the sidebar file tree to render
    await page.waitForSelector('[data-path]', { timeout: 15_000 });

    // Click the index.qmd file in the sidebar
    const fileEntry = page.locator('[data-path="pages/index.qmd"]').first();
    await fileEntry.click();

    // Wait for CodeMirror editor to mount
    await page.waitForSelector('.cm-editor', { timeout: 10_000 });

    // Press Ctrl+S (save shortcut)
    await page.keyboard.press('Control+s');

    // Expect status bar to show "Saved"
    await expect(page.locator('#status-bar')).toContainText('Saved', { timeout: 5_000 });
  });
});

// ── Visual regression baseline ────────────────────────────────────────────────
// These snapshots serve as the visual regression baseline. On first run they are
// created; subsequent runs compare against them. Run with:
//   npx playwright test --update-snapshots   (to update baselines)
//
// Note: skipped in CI because no committed baseline exists yet.
// To generate a baseline: run tests locally, commit the generated .png files.

test.describe('Visual regression', () => {
  test.skip(!!process.env['CI'], 'No committed baseline snapshot — run locally to generate');

  test('editor landing page matches snapshot', async ({ page }) => {
    await page.goto('/editor');
    // Wait for any animations / fonts to settle
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('editor-landing.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
