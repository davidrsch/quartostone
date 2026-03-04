// tests/e2e/phase8.spec.ts
// Acceptance tests for phase-8 UX polish features (#111–#118).
// Each describe block corresponds to one GitHub issue.
//
// PREREQUISITE: npm run build:client

import { test, expect } from '@playwright/test';

// ── #115 Light/dark theme toggle ──────────────────────────────────────────────

test.describe('#115 Light/dark theme toggle', () => {
  test('theme button is present in the sidebar header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-theme')).toBeVisible({ timeout: 8_000 });
  });

  test('clicking #btn-theme adds .light class to <html>', async ({ page }) => {
    await page.goto('/');
    // Start from dark (default); first click should switch to light
    const htmlEl = page.locator('html');
    const startedLight = await htmlEl.evaluate(el => el.classList.contains('light'));

    await page.locator('#btn-theme').click();

    const isLight = await htmlEl.evaluate(el => el.classList.contains('light'));
    expect(isLight).toBe(!startedLight);
  });

  test('clicking #btn-theme twice returns to original theme', async ({ page }) => {
    await page.goto('/');
    const htmlEl = page.locator('html');
    const initial = await htmlEl.evaluate(el => el.classList.contains('light'));

    await page.locator('#btn-theme').click();
    await page.locator('#btn-theme').click();

    const after = await htmlEl.evaluate(el => el.classList.contains('light'));
    expect(after).toBe(initial);
  });

  test('theme choice is persisted to localStorage', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-theme').click();

    const stored = await page.evaluate(() => localStorage.getItem('qs_theme'));
    expect(['light', 'dark']).toContain(stored);
  });

  test('theme is restored after page reload', async ({ page }) => {
    await page.goto('/');
    // Set to light
    await page.evaluate(() => localStorage.setItem('qs_theme', 'light'));
    await page.reload();

    const isLight = await page.locator('html').evaluate(el => el.classList.contains('light'));
    expect(isLight).toBe(true);
  });
});

// ── #116 Tooltips ─────────────────────────────────────────────────────────────

test.describe('#116 Tooltip title attributes', () => {
  const TITLED_BUTTONS = [
    { id: '#btn-mode-source',  contains: 'Source' },
    { id: '#btn-mode-visual',  contains: 'Visual' },
    { id: '#btn-properties',   contains: 'properties' },
    { id: '#btn-preview',      contains: 'preview' },
    { id: '#btn-save',         contains: 'Save' },
    { id: '#btn-commit',       contains: 'Commit' },
    { id: '#btn-new-page',     contains: 'page' },
    { id: '#btn-theme',        contains: 'theme' },
    { id: '#btn-graph',        contains: 'graph' },
  ];

  for (const { id, contains } of TITLED_BUTTONS) {
    test(`${id} has a title attribute containing "${contains}"`, async ({ page }) => {
      await page.goto('/');
      const title = await page.locator(id).getAttribute('title');
      expect(title).toBeTruthy();
      expect(title!.toLowerCase()).toContain(contains.toLowerCase());
    });
  }
});

// ── #113 Command palette ──────────────────────────────────────────────────────

test.describe('#113 Command palette', () => {
  test('Ctrl+K opens the command palette', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');

    const palette = page.locator('#cmd-palette');
    await expect(palette).not.toHaveClass(/hidden/, { timeout: 3_000 });
  });

  test('Escape closes the command palette', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.locator('#cmd-palette')).not.toHaveClass(/hidden/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#cmd-palette')).toHaveClass(/hidden/, { timeout: 3_000 });
  });

  test('clicking backdrop closes the command palette', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.locator('#cmd-palette')).not.toHaveClass(/hidden/);

    await page.locator('#cmd-palette-backdrop').click({ force: true });
    await expect(page.locator('#cmd-palette')).toHaveClass(/hidden/, { timeout: 3_000 });
  });

  test('typing in the palette filters results', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');

    const listBefore = await page.locator('#cmd-palette-list .cmd-item').count();
    await page.locator('#cmd-palette-input').fill('save');

    const listAfter = await page.locator('#cmd-palette-list .cmd-item').count();
    expect(listAfter).toBeLessThanOrEqual(listBefore);
    expect(listAfter).toBeGreaterThan(0);
  });

  test('ArrowDown moves selection to next item', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');

    // First item should be selected initially
    const items = page.locator('#cmd-palette-list .cmd-item');
    await expect(items.first()).toHaveClass(/selected/);

    // Press ArrowDown
    await page.locator('#cmd-palette-input').press('ArrowDown');

    // Second item should now be selected
    await expect(items.nth(1)).toHaveClass(/selected/);
    await expect(items.first()).not.toHaveClass(/selected/);
  });

  test('input is focused when palette opens', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    // Wait for the palette to be visible before asserting focus (headless timing)
    await expect(page.locator('#cmd-palette')).not.toHaveClass(/hidden/);
    await expect(page.locator('#cmd-palette-input')).toBeFocused({ timeout: 5_000 });
  });
});

// ── #111 Resizable sidebar ────────────────────────────────────────────────────

test.describe('#111 Resizable sidebar', () => {
  test('#sidebar-resizer element is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#sidebar-resizer')).toBeAttached({ timeout: 5_000 });
  });

  test('sidebar persists custom width from localStorage on reload', async ({ page }) => {
    await page.goto('/');
    // Set a known width via localStorage and reload
    await page.evaluate(() => localStorage.setItem('qs_sidebar_width', '320'));
    await page.reload();

    const width = await page.locator('#sidebar').evaluate(el => (el as HTMLElement).style.width);
    expect(width).toBe('320px');
  });
});

// ── #112 Tab bar ──────────────────────────────────────────────────────────────

test.describe('#112 Tab bar', () => {
  test('#tab-bar element is present in the DOM', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tab-bar')).toBeAttached({ timeout: 5_000 });
  });

  test('opening a page adds a tab to #tab-bar', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();

    await expect(page.locator('#tab-bar .editor-tab')).toHaveCount(1, { timeout: 5_000 });
  });

  test('active tab has .active class', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-tree .tree-item.file').first().click();

    await expect(page.locator('#tab-bar .editor-tab.active')).toHaveCount(1, { timeout: 5_000 });
  });
});

// ── #117 Status bar click actions ─────────────────────────────────────────────

test.describe('#117 Status bar click actions', () => {
  test('#sb-branch is a button element for click accessibility', async ({ page }) => {
    await page.goto('/');
    const tagName = await page.locator('#sb-branch').evaluate(el => el.tagName.toLowerCase());
    expect(tagName).toBe('button');
  });

  test('#sb-branch has a title tooltip', async ({ page }) => {
    await page.goto('/');
    const title = await page.locator('#sb-branch').getAttribute('title');
    expect(title).toBeTruthy();
  });
});

// ── Keyboard shortcuts dialog ─────────────────────────────────────────────────

test.describe('Keyboard shortcuts dialog', () => {
  test('#btn-kbd button is present in the toolbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-kbd')).toBeAttached({ timeout: 5_000 });
  });

  test('clicking #btn-kbd opens the #kbd-dialog', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-kbd').click();

    // <dialog> open attribute is set when showModal() is called
    const isOpen = await page.locator('#kbd-dialog').evaluate(
      el => (el as HTMLDialogElement).open,
    );
    expect(isOpen).toBe(true);
  });
});
