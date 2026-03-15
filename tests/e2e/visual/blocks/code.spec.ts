import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor, insertFromMenu, clickMenuItem, getProseMirror } from '../utils';

const MY_PAGE = 'e2e-blocks-code.qmd';

test.describe('Visual Editor - Code Blocks', () => {
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

  test('Fenced Code Block with Language', async ({ page }) => {
    const pm = getProseMirror(page);
    await pm.focus();
    // Click bottom to avoid YAML block focus issues
    await pm.click({ position: { x: 10, y: 100 }, force: true });
    await pm.focus();
    await page.keyboard.type('```python', { delay: 100 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('print("hello")', { delay: 50 });
    
    await expect(pm.locator('.pm-code-editor')).toBeVisible();
    // In PanMirror, the data-language might be on the inner CodeMirror
    await expect(pm.locator('.cm-content[data-language="python"]')).toBeVisible();
  });

  test('Executable Cell (Quarto)', async ({ page }) => {
    const pm = getProseMirror(page);
    await insertFromMenu(page, 'Executable Cell');
    await clickMenuItem(page, 'Python');
    
    await expect(pm.locator('.pm-code-editor')).toBeVisible();
    await expect(pm.locator('.cm-content')).toContainText('{python}');
  });
});
