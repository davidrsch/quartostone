// tests/e2e/ui-content.spec.ts
// End-to-end tests that actually interact with the browser UI — not just API calls.
// These verify that the editor renders content, pages can be opened, and the
// save/dirty cycle works correctly.
//
// PREREQUISITE: The client must be built before running these tests.
//   npm run build:client
//
// The fixture workspace has one page: pages/index.qmd

import { test, expect } from '@playwright/test';

// ── App Shell ─────────────────────────────────────────────────────────────────

test.describe('App shell loads', () => {
  test('root URL serves the app HTML', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Quartostone/i);
  });

  test('sidebar is visible on load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 10_000 });
  });

  test('file tree renders at least one page', async ({ page }) => {
    await page.goto('/');
    // Wait for the sidebar fetch to complete and tree to render.
    // The fixture workspace has one page, but parallel test runs may have
    // created additional pages, so we assert ≥1 rather than exactly 1.
    await expect(async () => {
      const count = await page.locator('#file-tree .tree-item.file').count();
      expect(count).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 10_000 });
  });

  test('#no-page-message is visible before any page is selected', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#no-page-message')).toBeVisible({ timeout: 5_000 });
  });
});

// ── Opening a page ────────────────────────────────────────────────────────────

test.describe('Opening a page from the sidebar', () => {
  test('clicking a file item hides the no-page message', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();
    await expect(page.locator('#no-page-message')).not.toBeVisible({ timeout: 8_000 });
  });

  test('CodeMirror editor becomes visible', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 8_000 });
  });

  test('editor contains page content text', async ({ page }) => {
    await page.goto('/');
    // Click specifically on index.qmd (the fixture page with known content).
    // Using data-path avoids depending on sort order when multiple pages exist.
    await page.locator('#file-tree .tree-item.file[data-path="index.qmd"]').click();
    // The fixture index page contains "Welcome to Quartostone"
    await expect(page.locator('.cm-content')).toContainText(
      'Welcome to Quartostone',
      { timeout: 8_000 },
    );
  });

  test('page title is updated in the toolbar after opening', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();
    // The title element should contain something non-empty after a page opens
    await expect(page.locator('#current-page-title')).not.toBeEmpty({ timeout: 8_000 });
  });
});

// ── Toolbar state ─────────────────────────────────────────────────────────────

test.describe('Toolbar state', () => {
  test('Save button is disabled before a page is opened', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-save')).toBeDisabled();
  });

  test('Commit button is disabled before a page is opened', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-commit')).toBeDisabled();
  });

  test('all toolbar buttons have a non-empty title attribute', async ({ page }) => {
    await page.goto('/');
    // Check key toolbar buttons have tooltip titles (from #116)
    const buttons = [
      '#btn-mode-source',
      '#btn-mode-visual',
      '#btn-properties',
      '#btn-save',
      '#btn-commit',
      '#btn-new-page',
      '#btn-new-db',
      '#btn-new-folder',
      '#btn-graph',
      '#btn-theme',
    ];
    for (const selector of buttons) {
      const el = page.locator(selector);
      const title = await el.getAttribute('title');
      expect(title, `${selector} should have a title tooltip`).toBeTruthy();
      expect(title!.length, `${selector} title should not be empty`).toBeGreaterThan(0);
    }
  });
});

// ── Dirty state ───────────────────────────────────────────────────────────────

test.describe('Dirty state tracking', () => {
  let originalContent: string;

  test.beforeEach(async ({ request }) => {
    const r = await request.get('/api/pages/index.qmd');
    originalContent = ((await r.json()) as { content: string }).content;
  });

  test.afterEach(async ({ request }) => {
    if (originalContent !== undefined) {
      await request.put('/api/pages/index.qmd', { data: { content: originalContent } });
    }
  });

  test('typing in the editor enables the Save button', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 8_000 });

    // Click into the editor then type
    await page.locator('.cm-content').click();
    await page.keyboard.type(' test-change');

    await expect(page.locator('#btn-save')).toBeEnabled({ timeout: 3_000 });
  });

  test('Ctrl+S shortcut triggers save when dirty', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 8_000 });

    await page.locator('.cm-content').click();
    await page.keyboard.type(' __e2e_save_test__');

    // Wait until dirty
    await expect(page.locator('#btn-save')).toBeEnabled({ timeout: 3_000 });

    // Trigger save via shortcut
    await page.keyboard.press('Control+s');

    // After save the button should return to disabled
    await expect(page.locator('#btn-save')).toBeDisabled({ timeout: 5_000 });
  });
});

// ── Status bar ────────────────────────────────────────────────────────────────

test.describe('Status bar', () => {
  test('#sb-branch shows current git branch', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#sb-branch')).not.toBeEmpty({ timeout: 5_000 });
  });
});
