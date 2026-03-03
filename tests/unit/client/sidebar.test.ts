// @vitest-environment happy-dom
// tests/unit/client/sidebar.test.ts
// Unit tests for sidebar utility functions and DOM rendering (#ph11).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sortNodes,
  filterNodesByPaths,
  findNodeByPath,
  collectFolderChoices,
  addRecentPage,
  initSidebar,
  type PageNode,
} from '../../../src/client/sidebar/index.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const FILE_A: PageNode = { name: 'alpha.qmd', path: 'alpha',   type: 'file' };
const FILE_B: PageNode = { name: 'beta.qmd',  path: 'beta',    type: 'file' };
const FILE_C: PageNode = { name: 'gamma.qmd', path: 'notes/gamma', type: 'file' };
const FOLDER_NOTES: PageNode = {
  name: 'notes', path: 'notes', type: 'folder',
  children: [FILE_C],
};
const FOLDER_EMPTY: PageNode = { name: 'empty', path: 'empty', type: 'folder', children: [] };

const TREE: PageNode[] = [FILE_A, FILE_B, FOLDER_NOTES, FOLDER_EMPTY];

// ── Mock fetch helper ─────────────────────────────────────────────────────────

type TrashItem = { id: string; name: string; deletedAt: string };

function stubFetch(pages: PageNode[] = [], trash: TrashItem[] = []) {
  const fn = vi.fn().mockImplementation((url: unknown) => {
    const u = String(url);
    if (u === '/api/pages') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(pages) });
    }
    if (u === '/api/trash') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(trash) });
    }
    if (u === '/api/links/graph') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ nodes: [] }) });
    }
    // Individual page GET (used by duplicatePage / updatePageIcon)
    if (u.startsWith('/api/pages/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: '# hello' }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'not found' }) });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

// ── sortNodes ─────────────────────────────────────────────────────────────────

describe('sortNodes', () => {
  it('sorts folders before files', () => {
    const items = [FILE_A, FOLDER_NOTES, FILE_B, FOLDER_EMPTY];
    const sorted = [...items].sort(sortNodes);
    expect(sorted[0].type).toBe('folder');
    expect(sorted[1].type).toBe('folder');
    expect(sorted[2].type).toBe('file');
    expect(sorted[3].type).toBe('file');
  });

  it('sorts files alphabetically by name', () => {
    const items = [FILE_B, FILE_A];
    const sorted = [...items].sort(sortNodes);
    expect(sorted[0].name).toBe('alpha.qmd');
    expect(sorted[1].name).toBe('beta.qmd');
  });

  it('sorts folders alphabetically by name', () => {
    const items = [FOLDER_NOTES, FOLDER_EMPTY];
    const sorted = [...items].sort(sortNodes);
    expect(sorted[0].name).toBe('empty');
    expect(sorted[1].name).toBe('notes');
  });

  it('treats equal-type equal-name nodes as equal (returns 0 or locale order)', () => {
    const dup: PageNode = { ...FILE_A };
    const result = sortNodes(FILE_A, dup);
    expect(result).toBe(0);
  });
});

// ── filterNodesByPaths ────────────────────────────────────────────────────────

describe('filterNodesByPaths', () => {
  it('returns only files whose path is in the set', () => {
    const paths = new Set(['alpha']);
    const filtered = filterNodesByPaths(TREE, paths);
    // FILE_A is at top level; FILE_B and FOLDER_NOTES/gamma are not in set
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe('alpha');
  });

  it('keeps a folder if any descendant file matches', () => {
    const paths = new Set(['notes/gamma']);
    const filtered = filterNodesByPaths(TREE, paths);
    // Should keep FOLDER_NOTES (with FILE_C) but drop FILE_A, FILE_B, FOLDER_EMPTY
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe('folder');
    expect(filtered[0].path).toBe('notes');
    expect(filtered[0].children).toHaveLength(1);
    expect(filtered[0].children![0].path).toBe('notes/gamma');
  });

  it('drops empty folders after filtering', () => {
    const paths = new Set(['alpha']); // none in FOLDER_NOTES
    const filtered = filterNodesByPaths(TREE, paths);
    const folderPaths = filtered.filter(n => n.type === 'folder').map(n => n.path);
    expect(folderPaths).not.toContain('notes');
  });

  it('returns empty array when no paths match', () => {
    const filtered = filterNodesByPaths(TREE, new Set(['nonexistent']));
    expect(filtered).toHaveLength(0);
  });

  it('handles an empty tree', () => {
    expect(filterNodesByPaths([], new Set(['alpha']))).toHaveLength(0);
  });
});

// ── findNodeByPath ────────────────────────────────────────────────────────────

describe('findNodeByPath', () => {
  it('finds a top-level file node', () => {
    const result = findNodeByPath(TREE, 'alpha');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('alpha.qmd');
  });

  it('finds a top-level folder node', () => {
    const result = findNodeByPath(TREE, 'notes');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('folder');
  });

  it('finds a nested file inside a folder', () => {
    const result = findNodeByPath(TREE, 'notes/gamma');
    expect(result).not.toBeNull();
    expect(result!.path).toBe('notes/gamma');
  });

  it('returns null for a path that does not exist', () => {
    expect(findNodeByPath(TREE, 'does-not-exist')).toBeNull();
  });

  it('returns null on an empty tree', () => {
    expect(findNodeByPath([], 'alpha')).toBeNull();
  });
});

// ── collectFolderChoices ──────────────────────────────────────────────────────

describe('collectFolderChoices', () => {
  const tree: PageNode[] = [
    FILE_A,
    { name: 'docs', path: 'docs', type: 'folder', children: [
      { name: 'sub', path: 'docs/sub', type: 'folder', children: [] },
    ]},
    FOLDER_EMPTY,
  ];

  it('returns all folders in the tree', () => {
    const choices = collectFolderChoices(tree, '');
    const paths = choices.map(c => c.path);
    expect(paths).toContain('docs');
    expect(paths).toContain('docs/sub');
    expect(paths).toContain('empty');
  });

  it('excludes the given path from results', () => {
    const choices = collectFolderChoices(tree, 'docs');
    const paths = choices.map(c => c.path);
    expect(paths).not.toContain('docs');
    // Sub-folders of the excluded path are also omitted (prevents moving into self)
    expect(paths).not.toContain('docs/sub');
    // Other unrelated folders are still present
    expect(paths).toContain('empty');
  });

  it('does not include file nodes', () => {
    const choices = collectFolderChoices(tree, '');
    const paths = choices.map(c => c.path);
    expect(paths).not.toContain('alpha');
  });

  it('indents nested folders with non-breaking spaces', () => {
    const choices = collectFolderChoices(tree, '');
    const sub = choices.find(c => c.path === 'docs/sub');
    expect(sub).toBeDefined();
    expect(sub!.label).toMatch(/^\u00a0/); // starts with non-breaking space
  });

  it('returns an empty array when there are no folders', () => {
    expect(collectFolderChoices([FILE_A, FILE_B], '')).toHaveLength(0);
  });
});

// ── addRecentPage (localStorage) ─────────────────────────────────────────────

describe('addRecentPage', () => {
  beforeEach(() => localStorage.clear());

  it('stores a page in qs_recent', () => {
    addRecentPage('alpha', 'alpha.qmd');
    const stored = JSON.parse(localStorage.getItem('qs_recent') ?? '[]') as Array<{ path: string; name: string }>;
    expect(stored[0]).toEqual({ path: 'alpha', name: 'alpha.qmd' });
  });

  it('deduplicates: same path bubbles to the top', () => {
    addRecentPage('alpha', 'alpha.qmd');
    addRecentPage('beta',  'beta.qmd');
    addRecentPage('alpha', 'alpha.qmd');
    const stored = JSON.parse(localStorage.getItem('qs_recent') ?? '[]') as Array<{ path: string; name: string }>;
    expect(stored[0].path).toBe('alpha');
    expect(stored.filter(r => r.path === 'alpha')).toHaveLength(1);
  });

  it('caps the list at 10 entries', () => {
    for (let i = 0; i < 15; i++) addRecentPage(`page${i}`, `page${i}.qmd`);
    const stored = JSON.parse(localStorage.getItem('qs_recent') ?? '[]') as unknown[];
    expect(stored.length).toBeLessThanOrEqual(10);
  });
});

// ── initSidebar DOM rendering ─────────────────────────────────────────────────

describe('initSidebar DOM rendering', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'file-tree';
    document.body.innerHTML = '';
    document.body.appendChild(container);
    // Also add toast container so sidebarToast doesn't console.error
    const tc = document.createElement('div');
    tc.id = 'toast-container';
    document.body.appendChild(tc);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders a file item for each file returned by the API', async () => {
    stubFetch([FILE_A, FILE_B]);
    await initSidebar(container, vi.fn());
    const items = container.querySelectorAll('.tree-item.file');
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it('renders a folder wrapper for a folder node', async () => {
    stubFetch([FOLDER_NOTES]);
    await initSidebar(container, vi.fn());
    // Folder has .tree-item.folder
    expect(container.querySelector('.tree-item.folder')).toBeTruthy();
  });

  it('calls onSelect when a file item is clicked', async () => {
    stubFetch([FILE_A]);
    const onSelect = vi.fn();
    await initSidebar(container, onSelect);
    const item = container.querySelector<HTMLElement>('.tree-item.file');
    expect(item).toBeTruthy();
    item!.click();
    expect(onSelect).toHaveBeenCalledWith('alpha', 'alpha.qmd');
  });

  it('highlights active path with .active class', async () => {
    stubFetch([FILE_A, FILE_B]);
    await initSidebar(container, vi.fn(), { getActivePath: () => 'alpha' });
    const activeItems = container.querySelectorAll('.tree-item.active');
    expect(activeItems.length).toBeGreaterThanOrEqual(1);
    expect(activeItems[0].getAttribute('aria-label')).toBe('alpha.qmd');
  });

  it('shows an error message when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await initSidebar(container, vi.fn());
    expect(container.querySelector('.sidebar-error')).toBeTruthy();
  });

  it('opens a context menu on contextmenu event on a file item', async () => {
    stubFetch([FILE_A]);
    await initSidebar(container, vi.fn());
    const item = container.querySelector<HTMLElement>('.tree-item.file');
    expect(item).toBeTruthy();

    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    item!.dispatchEvent(e);

    // Context menu should appear in document.body
    expect(document.querySelector('.ctx-menu')).toBeTruthy();
    // Clean up
    document.querySelector('.ctx-menu')?.remove();
  });

  it('context menu for file includes "Move to…" and "Duplicate" entries', async () => {
    stubFetch([FILE_A]);
    await initSidebar(container, vi.fn());
    const item = container.querySelector<HTMLElement>('.tree-item.file');
    item!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    const menu = document.querySelector('.ctx-menu');
    expect(menu).toBeTruthy();
    const labels = [...menu!.querySelectorAll('.ctx-item')].map(b => b.textContent ?? '');
    expect(labels.some(l => l.includes('Move to'))).toBe(true);
    expect(labels.some(l => l.includes('Duplicate'))).toBe(true);
    menu!.remove();
  });

  it('context menu for folder includes "Move to…" entry', async () => {
    stubFetch([FOLDER_NOTES]);
    await initSidebar(container, vi.fn());
    const folderItem = container.querySelector<HTMLElement>('.tree-item.folder');
    expect(folderItem).toBeTruthy();
    folderItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    const menu = document.querySelector('.ctx-menu');
    expect(menu).toBeTruthy();
    const labels = [...menu!.querySelectorAll('.ctx-item')].map(b => b.textContent ?? '');
    expect(labels.some(l => l.includes('Move to'))).toBe(true);
    menu!.remove();
  });

  it('replaces label with rename input on dblclick', async () => {
    stubFetch([FILE_A]);
    await initSidebar(container, vi.fn());
    const item = container.querySelector<HTMLElement>('.tree-item.file');
    item!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(item!.querySelector('input.tree-rename-input')).toBeTruthy();
  });

  it('pressing Escape during rename cancels and restores label', async () => {
    stubFetch([FILE_A]);
    await initSidebar(container, vi.fn());
    const item = container.querySelector<HTMLElement>('.tree-item.file');
    item!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = item!.querySelector<HTMLInputElement>('input.tree-rename-input');
    expect(input).toBeTruthy();
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(item!.querySelector('input.tree-rename-input')).toBeNull();
    expect(item!.querySelector('.label')).toBeTruthy();
  });

  it('pressing F2 on a file item triggers rename input', async () => {
    stubFetch([FILE_A]);
    await initSidebar(container, vi.fn());
    const item = container.querySelector<HTMLElement>('.tree-item.file');
    item!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(item!.querySelector('input.tree-rename-input')).toBeTruthy();
  });
});
