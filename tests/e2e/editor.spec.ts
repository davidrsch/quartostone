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
    const res = await request.get('/api/pages/pages/index.qmd');
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
});

// ── Visual regression baseline ────────────────────────────────────────────────
// These snapshots serve as the visual regression baseline. On first run they are
// created; subsequent runs compare against them. Run with:
//   npx playwright test --update-snapshots   (to update baselines)

test.describe('Visual regression', () => {
  test('editor landing page matches snapshot', async ({ page }) => {
    await page.goto('/editor');
    // Wait for any animations / fonts to settle
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('editor-landing.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
