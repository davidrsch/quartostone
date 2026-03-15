import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor } from '../utils';

const MY_PAGE = 'e2e-inline-links.qmd';

test.describe('Visual Editor - Links and Footnotes', () => {
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

  test('Insert Hyperlink (Ctrl+K)', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await page.keyboard.type('visit quarto');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+k');
    await page.locator('input[placeholder="URL"]').fill('https://quarto.org');
    await page.keyboard.press('Enter');
    
    await expect(pm.locator('a')).toHaveAttribute('href', 'https://quarto.org');
  });

  test('Insert Footnote', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await page.locator('span:has-text("Insert")').click();
    await page.locator('button:has-text("Footnote")').click();
    
    // Footnotes often render as a superscript number in-line
    await expect(pm.locator('.footnote-ref')).toBeVisible();
  });
});
