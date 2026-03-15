import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor, insertFromMenu } from '../utils';

const MY_PAGE = 'e2e-inline-math.qmd';

test.describe('Visual Editor - Inline & Display Math', () => {
  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${MY_PAGE}`, {
      data: { content: INITIAL_CONTENT },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/pages/${MY_PAGE}`).catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    await openVisualEditor(page, MY_PAGE);
    await clearEditor(page);
  });

  test('Inline Math ($E=mc^2$)', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await insertFromMenu(page, 'LaTeX Math');
    await page.locator('button:has-text("Inline Math")').click();
    await page.keyboard.type('E=mc^2');
    await page.keyboard.press('Enter');
    await expect(pm.locator('.math.inline')).toBeVisible();
  });

  test('Display Math ($$a^2 + b^2 = c^2$$)', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await insertFromMenu(page, 'LaTeX Math');
    await page.locator('button:has-text("Display Math")').click();
    await page.keyboard.type('a^2 + b^2 = c^2');
    await page.keyboard.press('Enter');
    await expect(pm.locator('.math.display')).toBeVisible();
  });
});
