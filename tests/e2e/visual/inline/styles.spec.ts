import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor, formatFromMenu, insertFromMenu } from '../utils';

const MY_PAGE = 'e2e-inline-styles.qmd';

test.describe('Visual Editor - Inline Styles', () => {
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

  test('Bold (Ctrl+B)', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await page.keyboard.type('Bold');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+b');
    await expect(pm.locator('strong')).toContainText('Bold');
  });

  test('Italic (Ctrl+I)', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await page.keyboard.type('Italic');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+i');
    await expect(pm.locator('em')).toContainText('Italic');
  });

  test('Underline (Ctrl+U)', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await page.keyboard.type('Underline');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+u');
    await expect(pm.locator('u')).toContainText('Underline');
  });

  test('Strikeout', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await page.keyboard.type('Strike');
    await page.keyboard.press('Control+a');
    // Format -> Strikeout (assuming menu structure from previous walkthroughs)
    await page.locator('span:has-text("Format")').click();
    await page.locator('button:has-text("Strikeout")').click();
    await expect(pm.locator('del, s')).toContainText('Strike');
  });

  test('Subscript and Superscript', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    
    await page.keyboard.type('Sub');
    await page.keyboard.press('Control+a');
    await page.locator('span:has-text("Format")').click();
    await page.locator('button:has-text("Text")').click();
    await page.locator('button:has-text("Subscript")').click();
    await expect(pm.locator('sub')).toContainText('Sub');

    await clearEditor(page);
    await page.keyboard.type('Sup');
    await page.keyboard.press('Control+a');
    await page.locator('span:has-text("Format")').click();
    await page.locator('button:has-text("Text")').click();
    await page.locator('button:has-text("Superscript")').click();
    await expect(pm.locator('sup')).toContainText('Sup');
  });
});
