// tests/e2e/visual/system/theme.spec.ts
import { test, expect } from '@playwright/test';
import { getProseMirror, navigateToVisualEditor } from '../utils';

test.describe('Visual Editor - Theme Synchronization', () => {
  // Clear localStorage to ensure we start in the default theme (dark)
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('qs_theme', 'dark'));
    await page.reload();
  });

  async function provisionPage(request: any, name: string, content: string) {
    const res = await request.put(`/api/pages/${encodeURIComponent(name)}`, {
      data: { content }
    });
    if (!res.ok()) throw new Error(`Could not provision ${name}: ${res.status()} ${await res.text()}`);
  }

  test('Visual editor inherits and updates theme correctly', async ({ page, request }) => {
    const pageName = `theme-sync-${Date.now()}.qmd`;
    await provisionPage(request, pageName, '# Theme Sync Test\n\nVerifying dark mode.');

    // 1. Initial Load (Dark Mode Default)
    await page.goto('/');
    page.on('dialog', d => d.accept());
    
    // Ensure host is dark
    const htmlEl = page.locator('html');
    await expect(htmlEl).not.toHaveClass(/\blight\b/);

    await navigateToVisualEditor(page, pageName);

    const pm = getProseMirror(page);
    await expect(pm).toBeVisible({ timeout: 20_000 });

    // Verify dark mode background color inside iframe
    let bgColor = await pm.evaluate(() => window.getComputedStyle(document.documentElement).getPropertyValue('--pm-background-color').trim());
    // Dark mode bg is expected to be roughly #1f1f1f
    expect(bgColor).toBe('#1f1f1f');

    // 2. Switch to Light Mode
    await page.locator('#btn-theme').click();
    await expect(htmlEl).toHaveClass(/\blight\b/);

    // Give the iframe a moment to receive the update if it's dynamic
    await page.waitForTimeout(1000);

    bgColor = await pm.evaluate(() => window.getComputedStyle(document.documentElement).getPropertyValue('--pm-background-color').trim());
    // Light mode bg is expected to be white #ffffff
    expect(bgColor).toBe('#ffffff');

    // 3. Switch back to Dark Mode
    await page.locator('#btn-theme').click();
    await expect(htmlEl).not.toHaveClass(/\blight\b/);

    await page.waitForTimeout(1000);

    bgColor = await pm.evaluate(() => window.getComputedStyle(document.documentElement).getPropertyValue('--pm-background-color').trim());
    expect(bgColor).toBe('#1f1f1f');
  });
});
