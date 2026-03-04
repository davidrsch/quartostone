// tests/e2e/split-editor.spec.ts
// Playwright E2E acceptance tests for the split editor pane (#140).
//
// PREREQUISITE: The editor client must be built before running these tests.
//   npm run build:client

import { test, expect } from '@playwright/test';

// ── #140 Split editor pane ────────────────────────────────────────────────────

test.describe('#140 Split editor pane — DOM structure', () => {
  test('#btn-split button is present in the toolbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-split')).toBeAttached({ timeout: 5_000 });
  });

  test('#btn-split is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-split')).toBeVisible({ timeout: 5_000 });
  });

  test('#btn-split has aria-pressed="false" initially', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-split')).toHaveAttribute('aria-pressed', 'false', { timeout: 5_000 });
  });

  test('#editor-pane-primary exists in the DOM', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#editor-pane-primary')).toBeAttached({ timeout: 5_000 });
  });

  test('#editor-pane-secondary exists in the DOM', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#editor-pane-secondary')).toBeAttached({ timeout: 5_000 });
  });

  test('#editor-pane-secondary is not visible by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#editor-pane-secondary')).toBeHidden({ timeout: 5_000 });
  });

  test('#editor-pane-divider exists in the DOM', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#editor-pane-divider')).toBeAttached({ timeout: 5_000 });
  });

  test('#tab-bar-2 exists in the secondary pane', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tab-bar-2')).toBeAttached({ timeout: 5_000 });
  });

  test('#editor-mount-2 exists in the secondary pane', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#editor-mount-2')).toBeAttached({ timeout: 5_000 });
  });
});

// ── Toggle behaviour ──────────────────────────────────────────────────────────

test.describe('#140 Split editor pane — toggle behaviour', () => {
  test('clicking #btn-split adds split-active class to #editor-split', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-split').click();
    await expect(page.locator('#editor-split')).toHaveClass(/split-active/, { timeout: 5_000 });
  });

  test('clicking #btn-split sets aria-pressed to "true"', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-split').click();
    await expect(page.locator('#btn-split')).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  });

  test('#editor-pane-secondary becomes visible after split is activated', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-split').click();
    await expect(page.locator('#editor-pane-secondary')).toBeVisible({ timeout: 5_000 });
  });

  test('clicking #btn-split a second time removes split-active class', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-split').click();
    await expect(page.locator('#editor-split')).toHaveClass(/split-active/, { timeout: 5_000 });
    await page.locator('#btn-split').click();
    await expect(page.locator('#editor-split')).not.toHaveClass(/split-active/, { timeout: 5_000 });
  });

  test('clicking #btn-split twice restores aria-pressed to "false"', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-split').click();
    await page.locator('#btn-split').click();
    await expect(page.locator('#btn-split')).toHaveAttribute('aria-pressed', 'false', { timeout: 5_000 });
  });

  test('#editor-pane-secondary is hidden again after split is deactivated', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-split').click();
    await page.locator('#btn-split').click();
    await expect(page.locator('#editor-pane-secondary')).toBeHidden({ timeout: 5_000 });
  });
});

// ── Secondary pane loads a CodeMirror editor ──────────────────────────────────

test.describe('#140 Split editor pane — secondary editor', () => {
  test('opening a page then activating split loads CodeMirror in secondary pane', async ({ page }) => {
    await page.goto('/');
    // Open the first available file in the tree
    await page.locator('#file-tree .tree-item.file').first().click();
    // Wait for the primary editor to mount
    await expect(page.locator('#editor-mount .cm-editor')).toBeVisible({ timeout: 10_000 });
    // Activate the split
    await page.locator('#btn-split').click();
    // Secondary pane should have its own CodeMirror instance
    await expect(page.locator('#editor-mount-2 .cm-editor')).toBeVisible({ timeout: 10_000 });
  });

  test('secondary pane tab bar shows a tab after split is activated with an open file', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();
    await expect(page.locator('#editor-mount .cm-editor')).toBeVisible({ timeout: 10_000 });
    await page.locator('#btn-split').click();
    await expect(page.locator('#tab-bar-2 .editor-tab')).toHaveCount(1, { timeout: 5_000 });
  });

  test('secondary pane tab shows .active class for the open file', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();
    await expect(page.locator('#editor-mount .cm-editor')).toBeVisible({ timeout: 10_000 });
    await page.locator('#btn-split').click();
    await expect(page.locator('#tab-bar-2 .editor-tab.active')).toHaveCount(1, { timeout: 5_000 });
  });

  test('closing split destroys the secondary editor (no .cm-editor in mount-2)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();
    await expect(page.locator('#editor-mount .cm-editor')).toBeVisible({ timeout: 10_000 });
    await page.locator('#btn-split').click();
    await expect(page.locator('#editor-mount-2 .cm-editor')).toBeVisible({ timeout: 10_000 });
    // Close the split
    await page.locator('#btn-split').click();
    await expect(page.locator('#editor-mount-2 .cm-editor')).toHaveCount(0, { timeout: 5_000 });
  });
});

// ── Pane focus ────────────────────────────────────────────────────────────────

test.describe('#140 Split editor pane — focus tracking', () => {
  test('#editor-pane-primary has .focused-pane class by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#editor-pane-primary')).toHaveClass(/focused-pane/, { timeout: 5_000 });
  });

  test('clicking in secondary pane moves .focused-pane to secondary', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();
    await expect(page.locator('#editor-mount .cm-editor')).toBeVisible({ timeout: 10_000 });
    await page.locator('#btn-split').click();
    // Click on the secondary pane wrapper to transfer focus
    await page.locator('#editor-pane-secondary').click({ force: true });
    await expect(page.locator('#editor-pane-secondary')).toHaveClass(/focused-pane/, { timeout: 5_000 });
    await expect(page.locator('#editor-pane-primary')).not.toHaveClass(/focused-pane/, { timeout: 5_000 });
  });
});

// ── Command palette ───────────────────────────────────────────────────────────

test.describe('#140 Split editor pane — command palette', () => {
  test('"Toggle split editor" entry appears in command palette', async ({ page }) => {
    await page.goto('/');
    // Open command palette via Ctrl+K
    await page.keyboard.press('Control+k');
    await expect(page.locator('#cmd-palette')).not.toHaveClass(/hidden/, { timeout: 5_000 });
    await expect(page.locator('#cmd-palette-list')).toContainText('Toggle split editor', { timeout: 5_000 });
  });

  test('command palette toggle split entry closes when activated', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.locator('#cmd-palette')).not.toHaveClass(/hidden/, { timeout: 5_000 });
    // Click the "Toggle split editor" item
    await page.locator('#cmd-palette-list').getByText('Toggle split editor').click();
    await expect(page.locator('#editor-split')).toHaveClass(/split-active/, { timeout: 5_000 });
    await expect(page.locator('#cmd-palette')).toHaveClass(/hidden/, { timeout: 5_000 });
  });
});

// ── Keyboard shortcut ─────────────────────────────────────────────────────────

test.describe('#140 Split editor pane — keyboard shortcut', () => {
  test('Ctrl+\\ activates the split', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+\\');
    await expect(page.locator('#editor-split')).toHaveClass(/split-active/, { timeout: 5_000 });
  });

  test('Ctrl+\\ a second time deactivates the split', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+\\');
    await expect(page.locator('#editor-split')).toHaveClass(/split-active/, { timeout: 5_000 });
    await page.keyboard.press('Control+\\');
    await expect(page.locator('#editor-split')).not.toHaveClass(/split-active/, { timeout: 5_000 });
  });

  test('Ctrl+\\ shortcut appears in the keyboard shortcuts dialog', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-kbd').click();
    await expect(page.locator('#kbd-dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#kbd-dialog')).toContainText('Toggle split editor', { timeout: 5_000 });
  });
});
