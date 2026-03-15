// tests/e2e/visual/blocks/lists.spec.ts
import { test, expect } from '@playwright/test';
import { INITIAL_CONTENT, openVisualEditor, clearEditor } from '../utils';

const MY_PAGE = 'e2e-blocks-lists.qmd';

test.describe('Visual Editor - Lists', () => {
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

  test('Bullet List (Loose/Tight)', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await page.keyboard.type('* Item 1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Item 2');
    await expect(pm.locator('ul > li')).toHaveCount(2);
  });

  test('Numbered List', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await page.keyboard.type('1. First');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second');
    await expect(pm.locator('ol > li')).toHaveCount(2);
  });

  test('Task List', async ({ page }) => {
    const pm = page.locator('.ProseMirror');
    await page.keyboard.type('- [ ] Task 1');
    await page.keyboard.press('Enter');
    await expect(pm.locator('ul.task-list')).toBeVisible();
    await expect(pm.locator('input[type="checkbox"]')).toBeVisible();
  });
});
