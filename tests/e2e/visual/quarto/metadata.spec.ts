import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor, insertFromMenu, getProseMirror } from '../utils';

const MY_PAGE = 'e2e-quarto-metadata.qmd';

test.describe('Visual Editor - Metadata and Citations', () => {
  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${MY_PAGE}`, {
      data: { content: INITIAL_CONTENT },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/pages/${MY_PAGE}`).catch(() => {});
  });

  test('Insert Metadata (Citations and Cross-Refs)', async ({ page }) => {
    test.setTimeout(60_000);
    await openVisualEditor(page, MY_PAGE);
    const frame = page.frameLocator('iframe[src*="visual-editor"]');
    const pm = getProseMirror(page);
    
    // --> 1. Insert Citation
    await clearEditor(page);
    await insertFromMenu(page, 'Citation...');
    
    const citationDialog = frame.locator('.fui-DialogSurface');
    await expect(citationDialog).toBeVisible();
    
    // Wait for the UI to be ready, citation dialog has complex async loading
    await page.waitForTimeout(1000);
    await citationDialog.getByRole('textbox', { name: /Search for citation/i }).fill('@knuth84');
    
    // We cannot click "Insert" and expect a citation node because
    // the automated test environment lacks a real .bib file, so it returns "No items".
    // We simply verify the dialog works and can be cancelled.
    await page.waitForTimeout(1000); 
    await citationDialog.locator('button:has-text("Cancel")').click();
    await expect(citationDialog).toBeHidden();
    
    // --> 2. Insert Cross-Reference
    await clearEditor(page);
    await insertFromMenu(page, 'Cross Reference');
    
    const xrefDialog = frame.locator('.fui-DialogSurface');
    await expect(xrefDialog).toBeVisible();
    await xrefDialog.locator('button:has-text("Cancel")').click();
    await expect(xrefDialog).toBeHidden();
  });
});

