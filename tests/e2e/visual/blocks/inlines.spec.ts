// tests/e2e/visual/blocks/inlines.spec.ts
import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor, getProseMirror, formatFromMenu, insertFromMenu } from '../utils';

const MY_PAGE = 'e2e-blocks-inlines.qmd';

test.describe('Visual Editor - Inline Formatting', () => {
  test.beforeAll(async ({ request }) => {
    // Create a fresh test page
    await request.post('/api/pages', {
      data: {
        path: MY_PAGE,
        content: INITIAL_CONTENT
      }
    });
  });

  test.beforeEach(async ({ page }) => {
    await openVisualEditor(page, MY_PAGE);
    await clearEditor(page);
  });

  test('Basic Marks (Bold, Italic, Code)', async ({ page }) => {
    const pm = getProseMirror(page);
    await pm.click({ position: { x: 5, y: 5 }, force: true });
    await pm.focus();

    // Bold
    await page.keyboard.press('Control+b');
    await page.keyboard.type('bold text', { delay: 50 });
    await page.keyboard.press('Control+b'); // Toggle off
    await page.keyboard.type(' normal text', { delay: 50 });
    
    await expect(pm.locator('strong')).toContainText('bold text');
    
    // Italic
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+i');
    await page.keyboard.type('italic text', { delay: 50 });
    await page.keyboard.press('Control+i');
    
    await expect(pm.locator('em')).toContainText('italic text');

    // Inline Code (Shortcut Ctrl+D in PanMirror based on previous logs)
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+d');
    await page.keyboard.type('inline code', { delay: 50 });
    await page.keyboard.press('Control+d');

    await expect(pm.locator('code')).toContainText('inline code');
  });

  test('Strikethrough via Shortcut', async ({ page }) => {
    const pm = getProseMirror(page);
    await pm.click({ position: { x: 5, y: 5 }, force: true });
    await pm.focus();

    await page.keyboard.type('~~', { delay: 100 });
    await page.keyboard.type('strike', { delay: 50 });
    await page.keyboard.type('~~', { delay: 100 });
    
    // Usually <del> or <s>
    await expect(pm.locator('del, s, strike')).toContainText('strike');
  });

  test('Links via Shortcut with Selection', async ({ page }) => {
    const pm = getProseMirror(page);
    // Click below where YAML would be
    await pm.click({ position: { x: 10, y: 100 }, force: true });
    await pm.focus();

    await page.keyboard.type('Click here', { delay: 50 });
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+k');
    
    const frame = page.frameLocator('iframe[src*="visual-editor"]');
    const dialog = frame.locator('.fui-DialogSurface, [role="dialog"], dialog').filter({ hasText: 'Link' }).first();
    await expect(dialog).toBeVisible({ timeout: 10000 });
    
    await dialog.locator('input, textbox, [role="textbox"]').first().fill('https://quarto.org');
    await dialog.locator('button').filter({ hasText: 'OK' }).click();

    await expect(pm.locator('a')).toHaveAttribute('href', 'https://quarto.org');
    await expect(pm.locator('a')).toContainText('Click here');
  });

  test('Inline Math shortcut', async ({ page }) => {
    const pm = getProseMirror(page);
    await pm.click({ position: { x: 5, y: 5 }, force: true });
    await pm.focus();

    // In many PM setups, typing $ triggers math or starts a math node
    await page.keyboard.type('$', { delay: 100 });
    // Typically it opens an inline editor or adds a class
    await page.keyboard.type('E=mc^2', { delay: 50 });
    await page.keyboard.type('$', { delay: 100 });

    // Look for math elements. PanMirror uses .pm-math-inline usually.
    // We'll search for things containing E=mc^2
    const math = pm.locator('.pm-math-inline, .math, span:has-text("E=mc^2")').first();
    await expect(math).toBeVisible();
  });
});
