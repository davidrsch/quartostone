import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor, formatFromMenu, insertFromMenu, getProseMirror } from '../utils';

const MY_PAGE = 'e2e-quarto-divs-spans.qmd';

test.describe('Visual Editor - Divs and Spans', () => {
  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${MY_PAGE}`, {
      data: { content: INITIAL_CONTENT },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/pages/${MY_PAGE}`).catch(() => {});
  });

  test('Insert Div and Span sequentially', async ({ page }) => {
    test.setTimeout(60_000);
    await openVisualEditor(page, MY_PAGE);
    
    const frame = page.frameLocator('iframe[src*="visual-editor"]');
    const pm = getProseMirror(page);
    
    // --> 1. Insert Div
    await clearEditor(page);
    await insertFromMenu(page, 'Div...');
    
    // Wait for the Div dialog
    const divDialog = frame.locator('.fui-DialogSurface');
    await expect(divDialog).toBeVisible();
    await divDialog.getByRole('textbox', { name: /Classes/i }).fill('my-class');
    await divDialog.getByRole('textbox', { name: /ID/i }).fill('my-id');
    await divDialog.locator('button:has-text("OK")').click();
    await expect(divDialog).toBeHidden();
    
    const div = pm.locator('div#my-id.my-class');
    await expect(div).toBeVisible();
    
    // --> 2. Insert Span
    await clearEditor(page);
    await pm.click();
    await pm.focus();
    await page.keyboard.type('Styled text');
    await page.keyboard.press('Shift+Home');
    await formatFromMenu(page, 'Span...');
    
    // Wait for the Span dialog
    const spanDialog = frame.locator('.fui-DialogSurface');
    await expect(spanDialog).toBeVisible();
    await spanDialog.getByRole('textbox', { name: /Classes/i }).fill('highlight');
    await spanDialog.locator('button:has-text("OK")').click();
    await expect(spanDialog).toBeHidden();
    
    await expect(pm.locator('span.highlight')).toContainText('Styled text');
  });
});

