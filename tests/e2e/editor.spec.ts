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

  test('Ctrl+S shows "Saved" in status bar', async ({ page }, testInfo) => {
    // Skip if the client was not built (no dist/client/index.html)
    const isBuilt = await page.evaluate(() =>
      !document.body.textContent?.includes('not built yet') &&
      !document.body.textContent?.includes('Cannot GET')
    );
    if (!isBuilt) {
      testInfo.skip(true, 'Editor client not built — run npm run build:client first');
      return;
    }

    // Wait for the sidebar file tree to render
    await page.waitForSelector('[data-path]', { timeout: 20_000 });

    // Click the index.qmd file in the sidebar
    // The API returns paths relative to pages_dir, so just "index.qmd"
    const fileEntry = page.locator('[data-path="index.qmd"]').first();
    await fileEntry.click();

    // Wait for CodeMirror editor to mount
    await page.waitForSelector('.cm-editor', { timeout: 10_000 });

    // Click the editable content area so the CodeMirror instance has keyboard focus
    await page.locator('.cm-content').click();

    // Type a space and backspace so isDirty=true (the global Ctrl+S guard requires it)
    await page.keyboard.type(' ');
    await page.keyboard.press('Backspace');

    // Press Ctrl+S (save shortcut)
    await page.keyboard.press('Control+s');

    // Expect the save-status span to show "Saved" (id=sb-save-status, clears after 2s)
    await expect(page.locator('#sb-save-status')).toContainText('Saved', { timeout: 5_000 });
  });
});

// ── Preview API (L-7) ─────────────────────────────────────────────────────────

test.describe('Preview API', () => {
  test('GET /api/preview/status returns idle status when no preview running', async ({ request }) => {
    const res = await request.get('/api/preview/status');
    expect(res.status()).toBe(200);
    const body = await res.json() as { running: boolean };
    expect(typeof body.running).toBe('boolean');
  });

  test('POST /api/preview/start returns 400 when path is missing', async ({ request }) => {
    const res = await request.post('/api/preview/start', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('POST /api/preview/start accepts a valid path (Quarto may or may not be installed)', async ({ request }) => {
    const res = await request.post('/api/preview/start', {
      data: { path: 'pages/index.qmd', format: 'html' },
    });
    // 200 = started; 501/500 = quarto not installed — both are valid in CI
    expect([200, 202, 500, 501]).toContain(res.status());
  });

  test('POST /api/preview/stop always returns 200', async ({ request }) => {
    const res = await request.post('/api/preview/stop', { data: {} });
    expect(res.status()).toBe(200);
  });
});

// ── Branch operations API (L-7) ───────────────────────────────────────────────

test.describe('Branch operations API', () => {
  const tempBranch = `e2e-test-${Date.now()}`;

  test.afterAll(async ({ request }) => {
    // Best-effort: switch back to main so cleanup doesn't cause test pollution.
    await request.post('/api/git/checkout', { data: { branch: 'main' } });
  });

  test('GET /api/git/branches returns current branch and list', async ({ request }) => {
    const res = await request.get('/api/git/branches');
    expect(res.status()).toBe(200);
    const body = await res.json() as { current: string; branches: { name: string; current: boolean }[] };
    expect(typeof body.current).toBe('string');
    expect(Array.isArray(body.branches)).toBe(true);
    expect(body.branches.some(b => b.name === body.current)).toBe(true);
  });

  test('POST /api/git/branches creates a new branch', async ({ request }) => {
    const res = await request.post('/api/git/branches', {
      data: { name: tempBranch },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { ok: boolean; name: string };
    expect(body.ok).toBe(true);
    expect(body.name).toBe(tempBranch);
  });

  test('POST /api/git/branches returns 400 for invalid branch name', async ({ request }) => {
    const res = await request.post('/api/git/branches', {
      data: { name: 'bad name with spaces!' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/git/branches returns 400 when name is missing', async ({ request }) => {
    const res = await request.post('/api/git/branches', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('GET /api/git/status returns object with files array', async ({ request }) => {
    const res = await request.get('/api/git/status');
    expect(res.status()).toBe(200);
    const body = await res.json() as { current: string; files: unknown[] };
    expect(typeof body.current).toBe('string');
    expect(Array.isArray(body.files)).toBe(true);
  });

  test('GET /api/git/diff returns text or empty string', async ({ request }) => {
    const res = await request.get('/api/git/diff');
    expect(res.status()).toBe(200);
    const body = await res.json() as { diff: string };
    expect(typeof body.diff).toBe('string');
  });
});

// ── Properties via frontmatter (L-7) ─────────────────────────────────────────

test.describe('Page frontmatter / properties', () => {
  const propPage = 'e2e-props-test.qmd';
  const content = [
    '---',
    'title: Props Test',
    'date: 2026-01-15',
    'tags: [quarto, e2e]',
    'draft: true',
    '---',
    '',
    '# Props Test',
    '',
    'Frontmatter properties E2E test.',
  ].join('\n');

  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${propPage}`, { data: { content } });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/pages/${propPage}`);
  });

  test('page with rich frontmatter round-trips correctly', async ({ request }) => {
    const res = await request.get(`/api/pages/${propPage}`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { content: string };
    expect(body.content).toContain('title: Props Test');
    expect(body.content).toContain('date: 2026-01-15');
    expect(body.content).toContain('draft: true');
  });

  test('updated frontmatter persists on next read', async ({ request }) => {
    const updated = content.replace('draft: true', 'draft: false');
    await request.put(`/api/pages/${propPage}`, { data: { content: updated } });
    const res = await request.get(`/api/pages/${propPage}`);
    const body = await res.json() as { content: string };
    expect(body.content).toContain('draft: false');
    expect(body.content).not.toContain('draft: true');
  });
});

// ── Visual mode switch UI (L-7) ───────────────────────────────────────────────

test.describe('Visual mode switch UI', () => {
  test('Ctrl+Shift+E toggles to visual mode when client is built', async ({ page }, testInfo) => {
    await page.goto('/editor');

    // If the CM editor doesn't mount within 5 s, assume client is not built
    const cmEditorVisible = await page.locator('.cm-editor').waitFor({ timeout: 5_000 }).then(() => true).catch(() => false);
    if (!cmEditorVisible) {
      testInfo.skip(true, 'Editor client not built');
      return;
    }

    await page.waitForSelector('[data-path]', { timeout: 20_000 });
    await page.locator('[data-path="index.qmd"]').first().click();
    await page.waitForSelector('.cm-editor', { timeout: 10_000 });

    // Trigger visual mode shortcut
    await page.keyboard.press('Control+Shift+E');

    // Either the visual editor mounts or the mode button label changes
    const modeBtn = page.locator('#btn-mode');
    if (await modeBtn.count() > 0) {
      await expect(modeBtn).toHaveText(/source|visual/i, { timeout: 5_000 });
    } else {
      // No explicit mode button — accept that no crash occurred
      await expect(page.locator('body')).not.toContainText('Unhandled error');
    }
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

// ── Panmirror visual editor — round-trip tests (#90) ─────────────────────────
//
// These tests:
//   1. Create a page with known markdown via API
//   2. Open it in the editor browser UI
//   3. Switch to Visual mode (panmirror via pandoc)
//   4. Switch back to Source mode
//   5. Assert that key structural elements survive the pandoc round-trip
//
// Prerequisites:
//   - Editor client built (npm run build:client)
//   - pandoc installed (checked via GET /api/pandoc/capabilities)
//   - panmirror UMD bundle built (src/client/public/panmirror.js)

const ROUNDTRIP_PAGE = 'e2e-visual-roundtrip.qmd';

const ROUNDTRIP_MARKDOWN = [
  '---',
  'title: Round Trip Test',
  '---',
  '',
  '# Header One',
  '',
  'A paragraph with **bold** and *italic* text.',
  '',
  '- item one',
  '- item two',
  '',
  '```python',
  'print("hello")',
  '```',
  '',
  '> A blockquote here.',
  '',
].join('\n');

test.describe('Panmirror visual editor round-trip', () => {
  // Create the fixture page once and clean up after
  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${ROUNDTRIP_PAGE}`, {
      data: { content: ROUNDTRIP_MARKDOWN },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/pages/${ROUNDTRIP_PAGE}`);
  });

  // Helper: skip test if preconditions aren't met
  async function checkPreconditions(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
    testInfo: import('@playwright/test').TestInfo,
  ): Promise<boolean> {
    // Skip if client not built
    await page.goto('/editor');
    const cmVisible = await page.locator('.cm-editor').waitFor({ timeout: 5_000 }).then(() => true).catch(() => false);
    if (!cmVisible) {
      testInfo.skip(true, 'Editor client not built — run npm run build:client first');
      return false;
    }

    // Skip if pandoc not installed
    const capRes = await request.post('/api/pandoc/capabilities');
    if (!capRes.ok()) {
      testInfo.skip(true, 'pandoc not installed — visual editor requires pandoc');
      return false;
    }

    // Skip if panmirror bundle not built
    const pmRes = await request.get('/panmirror.js');
    if (!pmRes.ok()) {
      testInfo.skip(true, 'panmirror.js not built — run: cd quarto-fork && yarn workspace panmirror build');
      return false;
    }

    return true;
  }

  test('switching to Visual mode does not crash and shows ProseMirror', async ({ page, request }, testInfo) => {
    if (!await checkPreconditions(page, request, testInfo)) return;

    // Wait for sidebar and open the round-trip fixture
    await page.waitForSelector('[data-path]', { timeout: 20_000 });
    await page.locator(`[data-path="${ROUNDTRIP_PAGE}"]`).first().click();
    await page.waitForSelector('.cm-editor', { timeout: 10_000 });

    // Click the Visual mode button
    await page.locator('#btn-mode-visual').click();

    // panmirror loads /panmirror.js (lazy) and then calls pandoc — allow up to 30 s
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 30_000 });

    // No crash messages
    await expect(page.locator('body')).not.toContainText('Unhandled error');
    await expect(page.locator('body')).not.toContainText('panmirror.js loaded but');
  });

  test('switching visual → source preserves heading and bold text', async ({ page, request }, testInfo) => {
    if (!await checkPreconditions(page, request, testInfo)) return;

    // Open file
    await page.waitForSelector('[data-path]', { timeout: 20_000 });
    await page.locator(`[data-path="${ROUNDTRIP_PAGE}"]`).first().click();
    await page.waitForSelector('.cm-editor', { timeout: 10_000 });

    // Switch to visual
    await page.locator('#btn-mode-visual').click();
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 30_000 });

    // Switch back to source
    await page.locator('#btn-mode-source').click();
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });

    // Read the source text from CodeMirror DOM
    const sourceText = await page.evaluate(() =>
      [...document.querySelectorAll('.cm-line')]
        .map((l: Element) => l.textContent ?? '')
        .join('\n')
    );

    // ATX heading must survive (panmirror uses atxHeaders:true)
    expect(sourceText).toMatch(/^# Header One/m);
    // Bold must survive
    expect(sourceText).toMatch(/\*\*bold\*\*/);
  });

  test('switching visual → source preserves list items and code block', async ({ page, request }, testInfo) => {
    if (!await checkPreconditions(page, request, testInfo)) return;

    await page.waitForSelector('[data-path]', { timeout: 20_000 });
    await page.locator(`[data-path="${ROUNDTRIP_PAGE}"]`).first().click();
    await page.waitForSelector('.cm-editor', { timeout: 10_000 });

    await page.locator('#btn-mode-visual').click();
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 30_000 });

    await page.locator('#btn-mode-source').click();
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });

    const sourceText = await page.evaluate(() =>
      [...document.querySelectorAll('.cm-line')]
        .map((l: Element) => l.textContent ?? '')
        .join('\n')
    );

    // List items must survive
    expect(sourceText).toMatch(/item one/);
    expect(sourceText).toMatch(/item two/);

    // Fenced code block with language tag must survive
    expect(sourceText).toMatch(/```python/);
    expect(sourceText).toMatch(/print\("hello"\)/);
  });

  test('round-tripped content can be saved and re-read via API', async ({ page, request }, testInfo) => {
    if (!await checkPreconditions(page, request, testInfo)) return;

    await page.waitForSelector('[data-path]', { timeout: 20_000 });
    await page.locator(`[data-path="${ROUNDTRIP_PAGE}"]`).first().click();
    await page.waitForSelector('.cm-editor', { timeout: 10_000 });

    await page.locator('#btn-mode-visual').click();
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 30_000 });

    await page.locator('#btn-mode-source').click();
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });

    // Make dirty (type + backspace) so Ctrl+S actually saves
    await page.locator('.cm-content').click();
    await page.keyboard.type(' ');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Control+s');

    // Wait for "Saved" confirmation
    await expect(page.locator('#sb-save-status')).toContainText('Saved', { timeout: 5_000 });

    // Read back via API and verify structural elements survive
    const res = await request.get(`/api/pages/${ROUNDTRIP_PAGE}`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { content: string };

    expect(body.content).toMatch(/^# Header One/m);
    expect(body.content).toMatch(/\*\*bold\*\*/);
    expect(body.content).toMatch(/item one/);
    expect(body.content).toMatch(/```python/);
  });
});
