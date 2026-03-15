import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor, insertFromMenu, getProseMirror } from '../utils';

const MY_PAGE = 'e2e-tables-crud.qmd';

test.describe('Visual Editor - Table CRUD', () => {
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

  test('Insert 3x3 Table', async ({ page }) => {
    const pm = getProseMirror(page);
    const frame = page.frameLocator('iframe[src*="visual-editor"]');
    await insertFromMenu(page, 'Table...');
    
    // Table dialog
    const dialog = frame.locator('.fui-DialogSurface');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Rows', { exact: true }).fill('3');
    await dialog.getByLabel('Columns', { exact: true }).fill('3');
    await dialog.locator('button:has-text("OK")').click();
    await expect(dialog).toBeHidden();
    
    // 3 body rows + 1 header row = 4 rows
    await expect(pm.locator('table tr')).toHaveCount(4);
    await expect(pm.locator('table tr:first-child td, table tr:first-child th')).toHaveCount(3);
  });

  test('Delete Table', async ({ page }) => {
    const pm = getProseMirror(page);
    const frame = page.frameLocator('iframe[src*="visual-editor"]');
    await insertFromMenu(page, 'Table...');
    
    const dialog = frame.locator('.fui-DialogSurface');
    await expect(dialog).toBeVisible();
    await dialog.locator('button:has-text("OK")').click();
    await expect(dialog).toBeHidden();
    
    // Wait for insertion
    await expect(pm.locator('table tr')).toHaveCount(4);
    
    // Click inside the table to reveal table menu context
    await pm.locator('table tr:first-child td, table tr:first-child th').first().click();
    
    // Use Table menu to delete (Toolbar button)
    await frame.getByRole('button', { name: 'Table' }).click();
    await frame.getByRole('menuitem', { name: 'Delete Table' }).click({ force: true });
    
    await expect(pm.locator('table')).not.toBeVisible();
  });
});
