// tests/e2e/visual/utils.ts
import { expect, Page } from '@playwright/test';

export const INITIAL_CONTENT = '\n';

/**
 * Returns the ProseMirror locator inside the visual editor iframe.
 */
export function getProseMirror(page: Page) {
  return page.frameLocator('iframe[src*="visual-editor"]').locator('.ProseMirror[contenteditable="true"]');
}

/**
 * Setup: Go to editor, ensure page is loaded, switch to visual mode.
 */
export async function openVisualEditor(page: Page, testPage: string) {
  // Ensure the page exists via API before navigating
  const res = await page.request.put(`/api/pages/${testPage}`, {
    data: { content: INITIAL_CONTENT }
  });
  if (!res.ok()) {
    throw new Error(`Failed to create test page ${testPage}: ${res.status()} ${await res.text()}`);
  }

  await navigateToVisualEditor(page, testPage);
}

/**
 * Navigate to an existing page and switch to Visual mode WITHOUT resetting content.
 * Use this after a save or when you want to verify persisted content.
 */
export async function navigateToVisualEditor(page: Page, testPage: string) {
  await page.goto('/editor');
  // Wait for sidebar to at least start loading
  await page.waitForSelector('#sidebar', { timeout: 10_000 });
  
  // Reload to ensure the file is visible in the sidebar
  await page.reload();
  
  const selector = `[data-path="${testPage}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.locator(selector).first().click();
  
  // Wait for the editor to load the file
  await page.waitForSelector('.cm-editor', { timeout: 20_000 });
  
  // Click Visual mode and wait for ProseMirror (inside iframe)
  const visualBtn = page.locator('#btn-mode-visual');
  await expect(visualBtn).toBeVisible({ timeout: 10_000 });
  await visualBtn.click();
  
  await expect(getProseMirror(page)).toBeVisible({ timeout: 40_000 });
  
  // Ensure we are focused in the editor
  const pm = getProseMirror(page);
  await pm.click({ position: { x: 10, y: 10 }, force: true });
}

/**
 * Clears the ProseMirror editor content.
 */
export async function clearEditor(page: Page) {
  const pm = getProseMirror(page);
  await pm.focus();
  await pm.click({ position: { x: 10, y: 10 }, force: true });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
}

/**
 * Inserts an element using the "Insert" menu.
 */
export async function insertFromMenu(page: Page, label: string) {
  const frame = page.frameLocator('iframe[src*="visual-editor"]');
  // Click the top-level "Insert" button
  const insertMenu = frame.locator('button').filter({ hasText: 'Insert' }).first();
  await insertMenu.click();
  
  // Wait for and click the menu item
  await clickMenuItem(page, label);
}

/**
 * Triggers a format from the "Format" menu.
 */
export async function formatFromMenu(page: Page, label: string) {
  const frame = page.frameLocator('iframe[src*="visual-editor"]');
  // Click the top-level "Format" button
  const formatMenu = frame.locator('button').filter({ hasText: 'Format' }).first();
  await formatMenu.click();
  
  // Wait for and click the menu item
  await clickMenuItem(page, label);
}

/**
 * Clicks an item in an ALREADY OPEN menu.
 */
export async function clickMenuItem(page: Page, label: string) {
  const frame = page.frameLocator('iframe[src*="visual-editor"]');
  const item = frame.locator('.fui-MenuItem, .fui-MenuItem__content').filter({ hasText: label }).first();
  
  // Wait for visibility and stability
  await expect(item).toBeVisible({ timeout: 10000 });
  
  // Some React menus need a tiny bit of time to attach all listeners
  await page.waitForTimeout(500);
  
  // Try to click. If it's a "detached" error, Playwright usually retries, 
  // but we can add a simple manual retry if needed.
  try {
    await item.click({ timeout: 5000, force: true });
  } catch (e: any) {
    if (e.message && e.message.includes('detached')) {
      // Re-locate and try once more if detached
      await frame.locator('.fui-MenuItem, .fui-MenuItem__content').filter({ hasText: label }).first().click({ force: true });
    } else {
      throw e;
    }
  }
}

/**
 * Verify that the ProseMirror contains specific text.
 */
export async function expectText(page: Page, text: string) {
  await expect(getProseMirror(page)).toContainText(text);
}
