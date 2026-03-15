import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor, insertFromMenu, getProseMirror } from '../utils';

const MY_PAGE = 'e2e-tables-alignment.qmd';

test.describe('Visual Editor - Table Alignment', () => {
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

  test('Set Column Alignment (Center)', async ({ page }) => {
    const pm = getProseMirror(page);
    const frame = page.frameLocator('iframe[src*="visual-editor"]');
    await insertFromMenu(page, 'Table...');
    
    const dialog = frame.locator('.fui-DialogSurface');
    await expect(dialog).toBeVisible();
    await dialog.locator('button:has-text("OK")').click();
    await expect(dialog).toBeHidden();
    
    await expect(pm.locator('table tr')).toHaveCount(4);
    
    await pm.locator('table tr:first-child td, table tr:first-child th').first().click();
    
    // Alignment path: Table > Align Column > Center
    await frame.getByRole('button', { name: 'Table' }).click();
    await frame.getByRole('menuitem', { name: 'Align Column' }).click();
    await frame.getByRole('menuitem', { name: 'Center' }).click({ force: true });
    
    // In PM, alignment often results in a style attribute or a data attribute
    // Quarto generates something like <td style="text-align: center;"> or <th style="text-align: center;">
    await expect(pm.locator('td, th').first()).toHaveAttribute('style', /text-align:\s*center/);
  });
});
