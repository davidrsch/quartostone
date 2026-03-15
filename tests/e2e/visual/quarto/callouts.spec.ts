import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor, insertFromMenu, getProseMirror } from '../utils';

const MY_PAGE = 'e2e-quarto-callouts.qmd';

test.describe('Visual Editor - Quarto Callouts', () => {
  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${MY_PAGE}`, {
      data: { content: INITIAL_CONTENT },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/pages/${MY_PAGE}`).catch(() => {});
  });

  test('Insert all Callout types sequentially', async ({ page }) => {
    test.setTimeout(120_000); // Allow ample time for all 5 insertions
    await openVisualEditor(page, MY_PAGE);
    
    const frame = page.frameLocator('iframe[src*="visual-editor"]');
    const pm = getProseMirror(page);
    
    const callouts = ['Note', 'Tip', 'Important', 'Warning', 'Caution'];

    for (const type of callouts) {
      await clearEditor(page);
      await insertFromMenu(page, 'Callout...');
      const dialog = frame.locator('.fui-DialogSurface');
      await expect(dialog).toBeVisible();
      
      // The type combobox
      await page.waitForTimeout(500);
      const combobox = dialog.getByRole('combobox', { name: /Type/i }).first();
      await combobox.click();
      await page.waitForTimeout(200);
      await page.keyboard.type(type);
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter');
      
      await dialog.locator('button:has-text("OK")').click();
      
      // Ensure the dialog closes
      await expect(dialog).toBeHidden();
      
      // Verify the callout is in the ProseMirror editor
      await expect(pm.locator(`.callout-${type.toLowerCase()}`)).toBeVisible();
    }
  });
});

