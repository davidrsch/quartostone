// tests/e2e/file-management.spec.ts
// Playwright E2E acceptance tests for Phase 11: File Management UI.
//
// Covers: rename, move (PATCH), folder create/delete (POST/DELETE directories),
// soft-delete to trash, restore from trash, permanent delete, duplicate page,
// and the context-menu / inline-rename UI affordances.
//
// PREREQUISITE: npm run build:client

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

// ── Helpers ───────────────────────────────────────────────────────────────────

const UNIQUE = Date.now();
/** Unique prefix to avoid collisions even if a prior run left artefacts. */
const P = `fm-${UNIQUE}`;

// ── PATCH: rename a file ──────────────────────────────────────────────────────

test.describe('PATCH /api/pages/:path — rename/move', () => {
  const src = `${P}-rename-src.qmd`;
  const dst = `${P}-rename-dst.qmd`;

  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${src}`, { data: { content: '# Rename source\n' } });
  });

  test.afterAll(async ({ request }) => {
    // Clean up: delete whichever end-state exists
    await request.delete(`/api/pages/${dst}`);
    await request.delete(`/api/pages/${src}`);
  });

  test('PATCH renames a file and returns 200', async ({ request }) => {
    const res = await request.patch(`/api/pages/${src}`, {
      data: { newPath: dst.replace(/\.qmd$/, '') },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('renamed file is accessible at its new path', async ({ request }) => {
    const res = await request.get(`/api/pages/${dst}`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { content: string };
    expect(body.content).toContain('Rename source');
  });

  test('old path returns 404 after rename', async ({ request }) => {
    const res = await request.get(`/api/pages/${src}`);
    expect(res.status()).toBe(404);
  });

  test('PATCH to existing path returns 409 conflict', async ({ request }) => {
    // dst already exists from the rename; patching it to itself (or another existing file) → 409
    const res = await request.patch(`/api/pages/${dst}`, {
      data: { newPath: 'index' }, // index.qmd always exists in fixture
    });
    expect(res.status()).toBe(409);
  });
});

// ── Directories API ───────────────────────────────────────────────────────────
// Each test is fully self-contained (delete-then-create or delete-only) so that
// Playwright retries never carry over stale state from a prior attempt.

test.describe('POST /api/directories and DELETE /api/directories/:path', () => {
  const folder = `${P}-dir`;

  test.afterAll(async ({ request }) => {
    // best-effort final cleanup
    await request.delete(`/api/directories/${folder}`);
  });

  test('POST /api/directories creates a folder and returns 201', async ({ request }) => {
    // idempotent setup: delete if it already exists, then create fresh
    await request.delete(`/api/directories/${folder}`);
    const res = await request.post('/api/directories', { data: { path: folder } });
    expect(res.status()).toBe(201);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('GET /api/pages tree includes the new folder', async ({ request }) => {
    // ensure folder exists regardless of how prior tests left things
    await request.delete(`/api/directories/${folder}`);
    await request.post('/api/directories', { data: { path: folder } });
    const res = await request.get('/api/pages');
    expect(res.status()).toBe(200);
    const flat = JSON.stringify(await res.json());
    expect(flat).toContain(folder);
  });

  test('POST /api/directories with existing path returns 409', async ({ request }) => {
    // ensure folder exists before checking duplicate-prevention
    await request.delete(`/api/directories/${folder}`);
    await request.post('/api/directories', { data: { path: folder } });
    const res = await request.post('/api/directories', { data: { path: folder } });
    expect(res.status()).toBe(409);
  });

  test('DELETE /api/directories removes an empty folder', async ({ request }) => {
    // ensure folder exists before deleting it
    await request.delete(`/api/directories/${folder}`);
    await request.post('/api/directories', { data: { path: folder } });
    const res = await request.delete(`/api/directories/${folder}`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/pages tree no longer contains deleted folder', async ({ request }) => {
    // ensure folder is absent before checking the tree
    await request.delete(`/api/directories/${folder}`);
    const res = await request.get('/api/pages');
    expect(res.status()).toBe(200);
    const flat = JSON.stringify(await res.json());
    expect(flat).not.toContain(`"${folder}"`);
  });
});

// ── Move via PATCH ────────────────────────────────────────────────────────────

test.describe('move page into a folder via PATCH', () => {
  const file   = `${P}-move-file.qmd`;
  const folder = `${P}-move-folder`;
  const moved  = `${folder}/${P}-move-file`;

  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${file}`, { data: { content: '# Move me\n' } });
    await request.post('/api/directories', { data: { path: folder } });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/pages/${moved}.qmd`);
    await request.delete(`/api/pages/${file}`);
    await request.delete(`/api/directories/${folder}`);
  });

  test('PATCH moves file into folder', async ({ request }) => {
    const res = await request.patch(`/api/pages/${file}`, {
      data: { newPath: moved },
    });
    expect(res.status()).toBe(200);
  });

  test('moved file is accessible at new path', async ({ request }) => {
    const res = await request.get(`/api/pages/${moved}.qmd`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { content: string };
    expect(body.content).toContain('Move me');
  });
});

// ── Trash (soft-delete) ───────────────────────────────────────────────────────
// The server stores trash items with `name` = path without the .qmd extension.
// Every test below is self-contained so Playwright retries are safe.

test.describe('soft-delete → trash → restore → permanent-delete lifecycle', () => {
  const page     = `${P}-trash-test.qmd`;
  // name as stored by the server (no .qmd suffix)
  const pageName = `${P}-trash-test`;

  /** Ensure page is in pages dir (restore or recreate if needed). */
  async function ensurePageExists(request: APIRequestContext) {
    const check = await request.get(`/api/pages/${page}`);
    if (check.status() !== 200) {
      // page might be in trash — restore it, or recreate
      const list = await (await request.get('/api/trash')).json() as Array<{ id: string; name: string }>;
      const trashed = list.find(i => i.name === pageName);
      if (trashed) {
        await request.post(`/api/trash/restore/${trashed.id}`);
      } else {
        await request.put(`/api/pages/${page}`, { data: { content: '# Trash test\n' } });
      }
    }
  }

  /** Ensure page is in trash (soft-delete if currently in pages dir). */
  async function ensurePageTrashed(request: APIRequestContext): Promise<string> {
    // Remove any existing trash entries for this page
    const list1 = await (await request.get('/api/trash')).json() as Array<{ id: string; name: string }>;
    for (const item of list1.filter(i => i.name === pageName)) {
      await request.delete(`/api/trash/${item.id}`);
    }
    // Ensure page exists in pages dir, then soft-delete
    await ensurePageExists(request);
    await request.delete(`/api/pages/${page}`);
    // Read back the new trash entry
    const list2 = await (await request.get('/api/trash')).json() as Array<{ id: string; name: string }>;
    const entry = list2.find(i => i.name === pageName);
    if (!entry) throw new Error('trash entry not found after soft-delete');
    return entry.id;
  }

  test.afterAll(async ({ request }) => {
    // best-effort final cleanup — remove from trash and pages
    const list = await (await request.get('/api/trash')).json() as Array<{ id: string; name: string }>;
    for (const item of list.filter(i => i.name === pageName)) {
      await request.delete(`/api/trash/${item.id}`);
    }
    await request.delete(`/api/pages/${page}`);
  });

  test('DELETE /api/pages soft-deletes file (returns 200 and moves to trash)', async ({ request }) => {
    await ensurePageExists(request);
    // Purge any previous trash entry for this page
    const list = await (await request.get('/api/trash')).json() as Array<{ id: string; name: string }>;
    for (const item of list.filter(i => i.name === pageName)) {
      await request.delete(`/api/trash/${item.id}`);
    }
    const res = await request.delete(`/api/pages/${page}`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/pages no longer lists the deleted file', async ({ request }) => {
    await ensurePageTrashed(request);
    const res = await request.get('/api/pages');
    expect(res.status()).toBe(200);
    const flat = JSON.stringify(await res.json());
    expect(flat).not.toContain(`"${pageName}"`);
  });

  test('GET /api/trash lists the deleted file', async ({ request }) => {
    await ensurePageTrashed(request);
    const res = await request.get('/api/trash');
    expect(res.status()).toBe(200);
    const items = await res.json() as Array<{ id: string; name: string; deletedAt: string }>;
    // server stores name WITHOUT .qmd extension
    const match = items.find(i => i.name === pageName);
    expect(match).toBeDefined();
  });

  test('POST /api/trash/restore/:id restores the file', async ({ request }) => {
    const id = await ensurePageTrashed(request);
    const res = await request.post(`/api/trash/restore/${id}`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/pages lists the restored file again', async ({ request }) => {
    // Ensure page is in pages dir (restore from trash or recreate)
    await ensurePageExists(request);
    const res = await request.get('/api/pages');
    expect(res.status()).toBe(200);
    const flat = JSON.stringify(await res.json());
    expect(flat).toContain(pageName);
  });

  test('DELETE /api/trash/:id permanently deletes', async ({ request }) => {
    const id = await ensurePageTrashed(request);
    const res = await request.delete(`/api/trash/${id}`);
    expect(res.status()).toBe(200);
  });

  test('permanently deleted file is not in trash any more', async ({ request }) => {
    // purge all trash entries for this page, then verify absence
    const list = await (await request.get('/api/trash')).json() as Array<{ id: string; name: string }>;
    for (const item of list.filter(i => i.name === pageName)) {
      await request.delete(`/api/trash/${item.id}`);
    }
    const res = await request.get('/api/trash');
    const items = await res.json() as Array<{ id: string; name: string }>;
    expect(items.find(i => i.name === pageName)).toBeUndefined();
  });
});

// ── Duplicate via PUT ─────────────────────────────────────────────────────────

test.describe('duplicate page — PUT with -copy suffix', () => {
  const original = `${P}-dup-orig.qmd`;
  const copy     = `${P}-dup-orig-copy.qmd`;

  test.beforeAll(async ({ request }) => {
    await request.put(`/api/pages/${original}`, {
      data: { content: '---\ntitle: Duplicate Original\n---\n\n# Original\n' },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/pages/${original}`);
    await request.delete(`/api/pages/${copy}`);
  });

  test('PUT /api/pages/:path creates the duplicate with the same content', async ({ request }) => {
    // Read original
    const readRes = await request.get(`/api/pages/${original}`);
    expect(readRes.status()).toBe(200);
    const { content } = await readRes.json() as { content: string };

    // Write copy
    const copyPath = copy.replace(/\.qmd$/, '');
    const writeRes = await request.put(`/api/pages/${copyPath}`, { data: { content } });
    expect(writeRes.status()).toBe(200);
  });

  test('copy is readable and has same content as original', async ({ request }) => {
    const [origRes, copyRes] = await Promise.all([
      request.get(`/api/pages/${original}`),
      request.get(`/api/pages/${copy}`),
    ]);
    expect(origRes.status()).toBe(200);
    expect(copyRes.status()).toBe(200);
    const orig = (await origRes.json() as { content: string }).content;
    const cp   = (await copyRes.json() as { content: string }).content;
    expect(cp).toBe(orig);
  });
});

// ── UI: context menu via browser ──────────────────────────────────────────────

test.describe('sidebar context-menu UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the sidebar to hydrate (at least one tree item visible)
    await page.waitForSelector('.tree-item', { timeout: 10_000 });
  });

  test('right-clicking a file item opens a context menu', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.ctx-menu')).toBeVisible({ timeout: 3_000 });
  });

  test('context menu for a file contains "Move to" option', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.ctx-item').filter({ hasText: /Move to/ })).toBeVisible({ timeout: 3_000 });
  });

  test('context menu for a file contains "Duplicate" option', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.ctx-item').filter({ hasText: /Duplicate/ })).toBeVisible({ timeout: 3_000 });
  });

  test('context menu for a file contains "Rename" option', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.ctx-item').filter({ hasText: /Rename/ })).toBeVisible({ timeout: 3_000 });
  });

  test('context menu for a file contains "Delete" option', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.ctx-item.danger').filter({ hasText: /Delete/ })).toBeVisible({ timeout: 3_000 });
  });

  test('context menu closes when Escape is pressed', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.ctx-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ctx-menu')).not.toBeVisible({ timeout: 2_000 });
  });

  test('context menu closes when clicking outside', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.ctx-menu')).toBeVisible();
    await page.mouse.click(10, 10); // click far top-left
    await expect(page.locator('.ctx-menu')).not.toBeVisible({ timeout: 2_000 });
  });
});

// ── UI: inline rename ─────────────────────────────────────────────────────────

test.describe('inline rename UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tree-item', { timeout: 10_000 });
  });

  test('double-clicking a file label opens a rename input', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.dblclick();
    await expect(fileItem.locator('input.tree-rename-input')).toBeVisible({ timeout: 3_000 });
  });

  test('pressing Escape in rename input cancels and restores the label', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.dblclick();
    const input = fileItem.locator('input.tree-rename-input');
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.press('Escape');
    await expect(input).not.toBeVisible({ timeout: 2_000 });
    await expect(fileItem.locator('.label')).toBeVisible();
  });

  test('pressing F2 on a focused tree item opens a rename input', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.focus();
    await page.keyboard.press('F2');
    await expect(fileItem.locator('input.tree-rename-input')).toBeVisible({ timeout: 3_000 });
    // Cancel to avoid side effects
    await page.keyboard.press('Escape');
  });
});

// ── UI: Move-to dialog ────────────────────────────────────────────────────────

test.describe('"Move to…" dialog UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tree-item', { timeout: 10_000 });
  });

  test('clicking "Move to…" in the context menu opens a dialog', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.click({ button: 'right' });
    const moveItem = page.locator('.ctx-item').filter({ hasText: /Move to/ });
    await expect(moveItem).toBeVisible({ timeout: 3_000 });
    await moveItem.click();
    // The dialog should now be open (HTML <dialog> element)
    await expect(page.locator('dialog[open]')).toBeVisible({ timeout: 3_000 });
  });

  test('"Move to…" dialog contains a folder select and Cancel button', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.click({ button: 'right' });
    await page.locator('.ctx-item').filter({ hasText: /Move to/ }).click();
    const dlg = page.locator('dialog[open]');
    await expect(dlg.locator('#qs-move-target')).toBeVisible({ timeout: 3_000 });
    await expect(dlg.locator('#btn-move-cancel')).toBeVisible();
  });

  test('"Move to…" dialog closes when Cancel is clicked', async ({ page }) => {
    const fileItem = page.locator('.tree-item.file').first();
    await fileItem.click({ button: 'right' });
    await page.locator('.ctx-item').filter({ hasText: /Move to/ }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.locator('#btn-move-cancel').click();
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 2_000 });
  });
});
