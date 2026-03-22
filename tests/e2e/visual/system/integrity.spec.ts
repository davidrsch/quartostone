// tests/e2e/visual/blocks/integrity.spec.ts
// Phase 4: System Integration & Integrity tests.
//
// Key design decisions:
//  - Unique page names per test (avoids cross-test state leakage).
//  - provisionPage writes initial content via PUT /api/pages/<name>.
//  - openVisualEditor is only used to SET UP a fresh page (it overwrites with '\n').
//    For verification after a save, we use navigateToVisualEditor which does NOT reset content.
//  - Save is verified via waitForResponse on the PUT /api/pages/<name> network call.

import { test, expect } from '@playwright/test';
import { navigateToVisualEditor, getProseMirror } from '../utils';

test.describe('Visual Editor - System Integration & Integrity', () => {
  test.setTimeout(90_000);

  // ──────────────────────────────────────────────────────────────────────────
  // Provision a page with known content via REST API.
  // ──────────────────────────────────────────────────────────────────────────
  async function provisionPage(request: any, name: string, content: string) {
    const res = await request.put(`/api/pages/${encodeURIComponent(name)}`, {
      data: { content }
    });
    if (!res.ok()) throw new Error(`Could not provision ${name}: ${res.status()} ${await res.text()}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Wait for the server to acknowledge a save for a given page.
  // ──────────────────────────────────────────────────────────────────────────
  function waitForSave(page: any, pageName: string) {
    return page.waitForResponse(
      (res: any) =>
        res.url().includes(`/api/pages/${encodeURIComponent(pageName)}`) &&
        res.request().method() === 'PUT',
      { timeout: 30_000 }
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Focus the ProseMirror, go to end-of-document, and append text so the
  // editor transitions from its initial state → dirty.
  // ──────────────────────────────────────────────────────────────────────────
  async function appendText(page: any, text: string) {
    const pm = getProseMirror(page);
    await pm.click({ force: true });
    await pm.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(text, { delay: 20 });
    // onEditorUpdated (→ onDirty) should fire and enable the Save button
    await expect(page.locator('#sb-save-status')).toHaveText('Unsaved changes', { timeout: 10_000 });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 1 – Source-mode save & reload
  // ══════════════════════════════════════════════════════════════════════════
  test('Save and Load in Source Mode', async ({ page, request }) => {
    const pageName = `integrity-src-${Date.now()}.qmd`;
    const testText = 'SOURCE_UNIQUE_CONTENT';

    await provisionPage(request, pageName, '# Source test\n');

    await page.goto('/');
    page.on('dialog', d => d.accept());
    await navigateToVisualEditor(page, pageName);

    // Switch to source mode
    await page.click('#btn-mode-source');
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 });

    await page.locator('.cm-content').click();
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(testText, { delay: 20 });

    await expect(page.locator('#sb-save-status')).toHaveText('Unsaved changes', { timeout: 10_000 });

    const savePromise = waitForSave(page, pageName);
    await page.click('#btn-save');
    await savePromise;

    // Navigate back without resetting content
    await page.goto('/');
    page.on('dialog', d => d.accept());
    await navigateToVisualEditor(page, pageName);
    await page.click('#btn-mode-source');
    await expect(page.locator('.cm-content')).toContainText(testText, { timeout: 20_000 });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 2 – Visual-mode save & reload round-trip
  // ══════════════════════════════════════════════════════════════════════════
  test('Save and Load Round-trip (Visual)', async ({ page, request }) => {
    const pageName = `integrity-vis-${Date.now()}.qmd`;
    const testText = ' VISUAL_UNIQUE_CONTENT';

    await provisionPage(request, pageName, '# Visual test\n\nBase content.\n');

    await page.goto('/');
    page.on('dialog', d => d.accept());
    await navigateToVisualEditor(page, pageName);
    await appendText(page, testText);

    const savePromise = waitForSave(page, pageName);
    await page.click('#btn-save');
    await savePromise;

    // Navigate back WITHOUT resetting content (don't use openVisualEditor)
    await page.goto('/');
    page.on('dialog', d => d.accept());
    await navigateToVisualEditor(page, pageName);
    await expect(getProseMirror(page)).toContainText(testText.trim(), { timeout: 20_000 });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 3 – YAML frontmatter survives a visual-mode save
  // ══════════════════════════════════════════════════════════════════════════
  test('YAML Frontmatter Preservation', async ({ page, request }) => {
    const pageName = `integrity-yaml-${Date.now()}.qmd`;
    const yamlContent = '---\ntitle: "Integrity Test"\nauthor: "E2E Robot"\n---\n\nInitial content.\n';

    await provisionPage(request, pageName, yamlContent);

    await page.goto('/');
    page.on('dialog', d => d.accept());
    await navigateToVisualEditor(page, pageName);

    const pm = getProseMirror(page);
    await expect(pm).toContainText('Initial content', { timeout: 20_000 });

    await appendText(page, ' Added via Visual Editor');

    const savePromise = waitForSave(page, pageName);
    await page.click('#btn-save');
    await savePromise;

    // Verify raw file content contains YAML and the appended text
    const response = await request.get(`/api/pages/${encodeURIComponent(pageName)}`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const rawContent = data.content as string;

    expect(rawContent).toContain('title: "Integrity Test"');
    expect(rawContent).toContain('author: "E2E Robot"');
    expect(rawContent).toContain('Added via Visual Editor');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 4 – Edited content on page A survives navigating away and back
  // ══════════════════════════════════════════════════════════════════════════
  test('Multi-page Navigation Persistence', async ({ page, request }) => {
    const prefix = Date.now();
    const pageA = `integrity-a-${prefix}.qmd`;
    const pageB = `integrity-b-${prefix}.qmd`;

    await provisionPage(request, pageA, '# Page A\n\nContent A.\n');
    await provisionPage(request, pageB, '# Page B\n\nContent B.\n');

    await page.goto('/');
    page.on('dialog', d => d.accept());

    // ── Edit and save page A ────────────────────────────────────────────────
    await navigateToVisualEditor(page, pageA);
    await appendText(page, ' Modified A');

    const saveA = waitForSave(page, pageA);
    await page.click('#btn-save');
    await saveA;

    // ── Navigate to page B ──────────────────────────────────────────────────
    const bSelector = `[data-path="${pageB}"]`;
    await page.waitForSelector(bSelector, { timeout: 15_000 });
    await page.locator(bSelector).first().click();
    await page.waitForFunction(
      (path: string) => document.getElementById('current-page-title')?.textContent?.includes(path.replace('.qmd', '')),
      pageB,
      { timeout: 15_000 }
    );
    await expect(getProseMirror(page)).toContainText('Content B', { timeout: 20_000 });

    // ── Navigate back to page A and verify persisted content ────────────────
    const aSelector = `[data-path="${pageA}"]`;
    await page.waitForSelector(aSelector, { timeout: 15_000 });
    await page.locator(aSelector).first().click();
    await page.waitForFunction(
      (path: string) => document.getElementById('current-page-title')?.textContent?.includes(path.replace('.qmd', '')),
      pageA,
      { timeout: 15_000 }
    );
    await expect(getProseMirror(page)).toContainText('Modified A', { timeout: 20_000 });
  });
});
