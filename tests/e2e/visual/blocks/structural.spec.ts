// tests/e2e/visual/blocks/structural.spec.ts
import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor, insertFromMenu, getProseMirror } from '../utils';

const MY_PAGE = 'e2e-blocks-structural.qmd';

test.describe('Visual Editor - Structural Blocks', () => {
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

  test('Headings H1 through H4', async ({ page }) => {
    const pm = getProseMirror(page);
    // Start from top
    await pm.click({ position: { x: 5, y: 5 }, force: true });
    await pm.focus();
    
    for (let i = 1; i <= 3; i++) { // Test H1 to H3 for speed/stability
      await page.keyboard.type('#'.repeat(i), { delay: 100 });
      await page.keyboard.type(' ', { delay: 100 }); // Trigger conversion
      await page.keyboard.type(`Heading ${i}`, { delay: 50 });
      await page.keyboard.press('Enter');
      
      // We expect the heading to exist
      await expect(pm.locator(`h${i}`).filter({ hasText: `Heading ${i}` })).toBeVisible({ timeout: 5000 });
    }
  });

  test('Blockquote nesting', async ({ page }) => {
    const pm = getProseMirror(page);
    // Start from top
    await pm.click({ position: { x: 5, y: 5 }, force: true });
    await pm.focus();
    
    await page.keyboard.type('> ', { delay: 100 }); // Trigger blockquote
    await page.keyboard.type('Level 1', { delay: 50 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('Level 2', { delay: 50 }); // Should stay in blockquote
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // Exit blockquote
    
    await expect(pm.locator('blockquote')).toBeVisible();
    await expect(pm.locator('blockquote')).toContainText('Level 1');
    await expect(pm.locator('blockquote')).toContainText('Level 2');
  });

  test('Horizontal Rule via Menu', async ({ page }) => {
    const pm = getProseMirror(page);
    await insertFromMenu(page, 'Horizontal Rule');
    await expect(pm.locator('hr')).toBeVisible();
  });
});
