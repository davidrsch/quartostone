// src/client/sidebar/index.ts
// Sidebar coordinator: page tree with drag-and-drop, tags, trash, and emoji picker.
// Context menu, inline rename, and favorites/recent management live in sub-modules.

import { focusAdjacentTreeItem } from '../treeNav.js';
import { showToast } from '../utils/toast.js';
import { escHtml } from '../utils/escape.js';
import { openContextMenu } from './contextMenu.js';
import { startRename } from './inlineRename.js';
import {
  getFavorites, isFavorite, toggleFavorite, getRecent,
  addRecentPage as _addRecentPage, buildSimpleList, buildRecentList,
} from './recentFavorites.js';

export { addRecentPage } from './recentFavorites.js';

export interface PageNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  icon?: string;
  children?: PageNode[];
}

export interface SidebarOptions {
  /** Called when "New page here" is triggered — host opens creation dialog scoped to folder */
  onNewPage?: (folderPath: string) => void;
  /** Called when "New folder here" is triggered */
  onNewFolder?: (folderPath: string) => void;
  /** Called after a page/folder is deleted so host can clear the editor */
  onDelete?: (path: string, type: 'file' | 'folder') => void;
  /** Returns the path currently open in the editor (for active highlight after re-render) */
  getActivePath?: () => string | null;
}

type SelectCallback = (path: string, name: string) => void;

// ── Section builder ───────────────────────────────────────────────
function buildSection(title: string, content: HTMLElement, startCollapsed = false): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'sidebar-section';
  const header = document.createElement('div');
  header.className = 'section-header';
  const chevron = document.createElement('span');
  chevron.className = 'section-chevron';
  chevron.textContent = startCollapsed ? '▶' : '▼';
  const titleSpan = document.createElement('span');
  titleSpan.textContent = title;
  header.append(chevron, titleSpan);
  let collapsed = startCollapsed;
  content.classList.add('sidebar-section-body');
  if (collapsed) content.classList.add('hidden');
  header.tabIndex = 0;
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', String(!startCollapsed));
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    content.classList.toggle('hidden', collapsed);
    chevron.textContent = collapsed ? '▶' : '▼';
    header.setAttribute('aria-expanded', String(!collapsed));
  });
  header.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      header.click();
    }
  });
  wrapper.append(header, content);
  return wrapper;
}

// ── Drag state ────────────────────────────────────────────────────────────────

let _dragPath: string | null = null;
let _dragName: string | null = null;

/** Module-level snapshot of the full page tree — updated on every refresh so that
 *  the "Move to…" dialog can enumerate available folders without prop-drilling. */
let _allNodes: PageNode[] = [];

/** Revision counter to prevent stale async section appends after re-render. */
let _renderRev = 0;

// ── Main export ───────────────────────────────────────────────────────────────

export async function initSidebar(
  containerEl: HTMLElement,
  onSelect: SelectCallback,
  options?: SidebarOptions,
): Promise<() => Promise<void>> {
  let allNodes: PageNode[] = [];

  // #99 — Tag filter state
  let activeTagFilter: string | null = null;
  let taggedPaths: Set<string> = new Set();

  const wrappedSelect: SelectCallback = (path, name) => {
    _addRecentPage(path, name);
    onSelect(path, name);
  };

  async function refresh() {
    try {
      const res = await fetch('/api/pages');
      if (!res.ok) throw new Error('Server error');
      allNodes = (await res.json()) as PageNode[];
      _allNodes = allNodes; // keep module-level in sync for Move-to dialog
    } catch {
      containerEl.innerHTML = '<p class="sidebar-error">Failed to load pages.</p>';
      return;
    }
    render();
  }

  function render() {
    const rev = ++_renderRev;
    containerEl.innerHTML = '';
    const activePath = options?.getActivePath?.() ?? null;

    // #99 — Tag filter banner
    if (activeTagFilter !== null) {
      const banner = document.createElement('div');
      banner.className = 'sidebar-tag-filter-banner';
      banner.textContent = '';
      const _tagSpan = document.createElement('span');
      _tagSpan.append('Tag: ');
      const _tagStrong = document.createElement('strong');
      _tagStrong.textContent = activeTagFilter;
      _tagSpan.appendChild(_tagStrong);
      banner.appendChild(_tagSpan);
      const clearBtn = document.createElement('button');
      clearBtn.className = 'sidebar-tag-filter-clear';
      clearBtn.textContent = '✕ Clear';
      clearBtn.addEventListener('click', () => {
        activeTagFilter = null;
        taggedPaths = new Set();
        render();
      });
      banner.appendChild(clearBtn);
      containerEl.appendChild(banner);
    }

    // Favorites section
    const favPaths = getFavorites();
    const favNodes = favPaths
      .map(p => findNodeByPath(allNodes, p))
      .filter((n): n is PageNode => n !== null);
    if (favNodes.length > 0) {
      containerEl.appendChild(buildSection('Favorites', buildSimpleList(favNodes, wrappedSelect, activePath, '★')));
    }

    // Recent section
    const recent = getRecent();
    if (recent.length > 0) {
      containerEl.appendChild(buildSection('Recent', buildRecentList(recent, wrappedSelect, activePath), true));
    }

    // Pages tree (filtered by tag if active)
    const nodesToShow = activeTagFilter !== null
      ? filterNodesByPaths(allNodes, taggedPaths)
      : allNodes;

    const treeEl = document.createElement('div');
    treeEl.className = 'tree-root';

    // Root-level drop zone
    treeEl.addEventListener('dragover', e => {
      if (!_dragPath) return;
      const currentDir = _dragPath.includes('/') ? _dragPath.split('/').slice(0, -1).join('/') : '';
      if (currentDir === '') return;
      e.preventDefault();
      treeEl.classList.add('drag-over-root');
    });
    treeEl.addEventListener('dragleave', e => {
      if (!treeEl.contains(e.relatedTarget as Node)) treeEl.classList.remove('drag-over-root');
    });
    treeEl.addEventListener('drop', async e => {
      treeEl.classList.remove('drag-over-root');
      e.preventDefault();
      if (!_dragPath || !_dragName) return;
      const p = _dragPath; const n = _dragName;
      _dragPath = null; _dragName = null;
      await movePage(p, n, '', refresh);
    });

    for (const node of [...nodesToShow].sort(sortNodes)) {
      treeEl.appendChild(buildNode(node, wrappedSelect, options, refresh, activePath, 0));
    }
    containerEl.appendChild(treeEl);

    // Tags section (#99, async, appends itself when ready)
    void buildTagsSection(containerEl, activeTagFilter, (tag, paths) => {
      activeTagFilter = tag;
      taggedPaths = paths;
      render();
    }, rev);

    // Trash tray (async, appends itself when ready)
    void buildTrashSection(containerEl, refresh, rev);
  }

  await refresh();
  return refresh;
}

// ── Node builders ─────────────────────────────────────────────────────────────

function buildNode(
  node: PageNode,
  onSelect: SelectCallback,
  opts: SidebarOptions | undefined,
  onRefresh: () => Promise<void>,
  activePath: string | null,
  depth: number,
): HTMLElement {
  return node.type === 'folder'
    ? buildFolderNode(node, onSelect, opts, onRefresh, activePath, depth)
    : buildFileNode(node, onSelect, opts, onRefresh, activePath, depth);
}

// ─── Build a single tree node ─────────────────────────────────────────────────
function buildFileNode(
  node: PageNode,
  onSelect: SelectCallback,
  opts: SidebarOptions | undefined,
  onRefresh: () => Promise<void>,
  activePath: string | null,
  depth: number,
): HTMLElement {
  const item = document.createElement('div');
  item.className = `tree-item file${activePath === node.path ? ' active' : ''}`;
  item.dataset['path'] = node.path;
  item.draggable = true;
  item.style.paddingLeft = `${16 + depth * 14}px`;
  item.tabIndex = 0;
  item.setAttribute('role', 'treeitem');
  item.setAttribute('aria-label', node.name);
  item.setAttribute('aria-selected', String(activePath === node.path));

  // Keyboard navigation (#114)
  item.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      item.click();
    } else if (e.key === 'F2') {
      e.preventDefault();
      const lbl = item.querySelector<HTMLSpanElement>('.label');
      if (lbl) startRename(lbl, node, onRefresh);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void deleteItem(node, opts, onRefresh);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAdjacentTreeItem(item, -1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAdjacentTreeItem(item, 1);
    }
  });

  const icon = document.createElement('span');
  icon.className = 'page-icon';
  icon.title = 'Click to change icon';
  icon.textContent = node.icon ?? '📄';
  icon.addEventListener('click', e => {
    e.stopPropagation();
    openEmojiPicker(icon, node.path, (emoji) => {
      icon.textContent = emoji;
      node.icon = emoji;
    });
  });

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.name;

  item.append(icon, label);

  item.addEventListener('click', e => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if ((e.target as HTMLElement).closest('.page-icon')) return;
    document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    onSelect(node.path, node.name);
  });

  item.addEventListener('dblclick', e => {
    e.stopPropagation();
    const lbl = item.querySelector<HTMLSpanElement>('.label');
    if (lbl) startRename(lbl, node, onRefresh);
  });

  item.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    const parentFolder = node.path.includes('/')
      ? node.path.split('/').slice(0, -1).join('/')
      : '';
    openContextMenu(e, [
      { label: '+ New page here',   action: () => opts?.onNewPage?.(parentFolder) },
      { label: '+ New folder here', action: () => opts?.onNewFolder?.(parentFolder) },
      'separator',
      { label: '✎ Rename',          action: () => { const lbl = item.querySelector<HTMLSpanElement>('.label'); if (lbl) startRename(lbl, node, onRefresh); } },
      { label: '📁 Move to\u2026',    action: () => openMoveDialog(node, onRefresh) },
      { label: '\u29c9 Duplicate',   action: () => void duplicatePage(node, onRefresh) },
      { label: isFavorite(node.path) ? '★ Remove from favorites' : '☆ Add to favorites',
        action: () => { toggleFavorite(node.path); void onRefresh(); } },
      'separator',
      { label: '⧉ Copy wiki-link',  action: () => { navigator.clipboard.writeText(`[[${node.name}]]`).catch(() => {}); } },
      'separator',
      { label: '🗑 Delete', danger: true, action: () => void deleteItem(node, opts, onRefresh) },
    ]);
  });

  item.addEventListener('dragstart', e => {
    _dragPath = node.path; _dragName = node.name;
    e.dataTransfer?.setData('text/plain', node.path);
    item.classList.add('dragging');
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    _dragPath = null; _dragName = null;
  });

  return item;
}

function buildFolderNode(
  node: PageNode,
  onSelect: SelectCallback,
  opts: SidebarOptions | undefined,
  onRefresh: () => Promise<void>,
  activePath: string | null,
  depth: number,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.dataset['folderPath'] = node.path;

  const item = document.createElement('div');
  item.className = 'tree-item folder';
  item.style.paddingLeft = `${16 + depth * 14}px`;
  item.tabIndex = 0;
  item.setAttribute('role', 'treeitem');
  item.setAttribute('aria-label', node.name);
  item.setAttribute('aria-expanded', 'false');

  // Keyboard navigation (#114)
  item.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
      e.preventDefault();
      item.click();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (open) item.click(); // collapse
    } else if (e.key === 'F2') {
      e.preventDefault();
      const lbl = item.querySelector<HTMLSpanElement>('.label');
      if (lbl) startRename(lbl, node, onRefresh);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void deleteItem(node, opts, onRefresh);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAdjacentTreeItem(item, -1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAdjacentTreeItem(item, 1);
    }
  });

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = '▶';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.name;

  item.append(icon, label);

  const childrenEl = document.createElement('div');
  childrenEl.className = 'tree-children';
  childrenEl.style.display = 'none';
  let open = false;

  if (node.children && node.children.length > 0) {
    for (const child of [...node.children].sort(sortNodes)) {
      childrenEl.appendChild(buildNode(child, onSelect, opts, onRefresh, activePath, depth + 1));
    }
  } else {
    const empty = document.createElement('div');
    empty.className = 'tree-empty-folder';
    empty.style.paddingLeft = `${16 + (depth + 1) * 14}px`;
    empty.textContent = 'Empty folder';
    childrenEl.appendChild(empty);
  }

  item.addEventListener('click', e => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.stopPropagation();
    open = !open;
    childrenEl.style.display = open ? 'block' : 'none';
    icon.textContent = open ? '▼' : '▶';
    item.setAttribute('aria-expanded', String(open));
  });

  item.addEventListener('dblclick', e => {
    e.stopPropagation();
    const lbl = item.querySelector<HTMLSpanElement>('.label');
    if (lbl) startRename(lbl, node, onRefresh);
  });

  item.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    openContextMenu(e, [
      { label: '+ New page here',   action: () => opts?.onNewPage?.(node.path) },
      { label: '+ New folder here', action: () => opts?.onNewFolder?.(node.path) },
      'separator',
      { label: '✎ Rename',          action: () => { const lbl = item.querySelector<HTMLSpanElement>('.label'); if (lbl) startRename(lbl, node, onRefresh); } },
      { label: '📁 Move to\u2026',    action: () => openMoveDialog(node, onRefresh) },
      { label: isFavorite(node.path) ? '★ Remove from favorites' : '☆ Add to favorites',
        action: () => { toggleFavorite(node.path); void onRefresh(); } },
      'separator',
      { label: '🗑 Delete folder', danger: true, action: () => void deleteItem(node, opts, onRefresh) },
    ]);
  });

  // Accept drops
  item.addEventListener('dragover', e => {
    if (!_dragPath || _dragPath === node.path || _dragPath.startsWith(node.path + '/')) return;
    e.preventDefault(); e.stopPropagation();
    item.classList.add('drag-over');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
  item.addEventListener('drop', async e => {
    item.classList.remove('drag-over');
    e.preventDefault(); e.stopPropagation();
    if (!_dragPath || !_dragName) return;
    if (_dragPath === node.path || _dragPath.startsWith(node.path + '/')) return;
    const p = _dragPath; const n = _dragName;
    _dragPath = null; _dragName = null;
    await movePage(p, n, node.path, onRefresh);
  });

  wrapper.append(item, childrenEl);
  return wrapper;
}

// ── Delete helper ─────────────────────────────────────────────────────────────

async function deleteItem(
  node: PageNode,
  opts: SidebarOptions | undefined,
  onRefresh: () => Promise<void>,
): Promise<void> {
  const msg = node.type === 'file'
    ? `Move "${node.name}" to trash?`
    : `Delete folder "${node.name}"? (Only works if empty)`;
  if (!confirm(msg)) return;

  const encoded = node.path.split('/').map(encodeURIComponent).join('/');
  const url = node.type === 'file'
    ? `/api/pages/${encoded}`
    : `/api/directories/${encoded}`;

  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
    await onRefresh();
  } catch (err) {
    showToast(`Delete failed: ${String(err)}`, 'error', 4000);
  }
}

// ── Move (drag-and-drop) ──────────────────────────────────────────────────────

async function movePage(
  dragPath: string,
  dragName: string,
  targetFolder: string,
  onRefresh: () => Promise<void>,
): Promise<void> {
  const currentDir = dragPath.includes('/') ? dragPath.split('/').slice(0, -1).join('/') : '';
  if (currentDir === targetFolder) return;
  const newPath = targetFolder ? `${targetFolder}/${dragName}` : dragName;
  try {
    const encoded = dragPath.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`/api/pages/${encoded}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
    await onRefresh();
  } catch (err) {
    showToast(`Move failed: ${String(err)}`, 'error', 4000);
  }
}

// ── Move-to dialog (#ph11) ────────────────────────────────────────────────────

/** Collect all folder-path/label pairs from the tree, excluding `excludePath` itself. */
export function collectFolderChoices(
  nodes: PageNode[],
  excludePath: string,
  indent = 0,
  acc: Array<{ path: string; label: string }> = [],
): Array<{ path: string; label: string }> {
  for (const n of nodes) {
    if (n.type === 'folder' && n.path !== excludePath) {
      acc.push({ path: n.path, label: '\u00a0'.repeat(indent * 3) + n.name });
      collectFolderChoices(n.children ?? [], excludePath, indent + 1, acc);
    }
  }
  return acc;
}

function openMoveDialog(node: PageNode, onRefresh: () => Promise<void>): void {
  const folders: Array<{ path: string; label: string }> = [
    { path: '', label: '(root)' },
    ...collectFolderChoices(_allNodes, node.path),
  ];

  const currentFolder = node.path.includes('/')
    ? node.path.split('/').slice(0, -1).join('/')
    : '';

  const dlg = document.createElement('dialog');
  dlg.className = 'qs-dialog';

  const form = document.createElement('form');
  form.method = 'dialog';

  const titleEl = document.createElement('h3');
  titleEl.innerHTML = `Move \u201c${escHtml(node.name)}\u201d to\u2026`;

  const labelEl = document.createElement('label');
  labelEl.htmlFor = 'qs-move-target';
  labelEl.textContent = 'Destination folder';

  const select = document.createElement('select');
  select.id = 'qs-move-target';
  for (const folder of folders) {
    const opt = document.createElement('option');
    opt.value = folder.path;
    opt.textContent = folder.label;
    if (folder.path === currentFolder) opt.selected = true;
    select.appendChild(opt);
  }

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'dialog-actions';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'submit';
  confirmBtn.textContent = 'Move';
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'btn-move-cancel';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  actionsDiv.append(confirmBtn, cancelBtn);

  form.append(titleEl, labelEl, select, actionsDiv);
  dlg.appendChild(form);

  cancelBtn.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const targetFolder = select.value;
    dlg.close();
    void movePage(node.path, node.name, targetFolder, onRefresh);
  });

  document.body.appendChild(dlg);
  (dlg).showModal();
}

// ── Duplicate page (#ph11) ────────────────────────────────────────────────────

async function duplicatePage(node: PageNode, onRefresh: () => Promise<void>): Promise<void> {
  try {
    const encoded = node.path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`/api/pages/${encoded}`);
    if (!res.ok) throw new Error('Failed to read page');
    const { content } = await res.json() as { content: string };

    const folder = node.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : '';
    const baseName = node.path.includes('/') ? node.path.split('/').at(-1)! : node.path;
    const nameNoExt = baseName.replace(/\.qmd$/i, '');
    const copyPath = folder ? `${folder}/${nameNoExt}-copy` : `${nameNoExt}-copy`;

    const copyEncoded = copyPath.split('/').map(encodeURIComponent).join('/');
    const putRes = await fetch(`/api/pages/${copyEncoded}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!putRes.ok) throw new Error('Failed to create copy');
    await onRefresh();
  } catch (err) {
    showToast(`Duplicate failed: ${String(err)}`, 'error', 4000);
  }
}

// ── Tags section (#99) ────────────────────────────────────────────────────────

async function buildTagsSection(
  containerEl: HTMLElement,
  activeTag: string | null,
  onTagClick: (tag: string | null, paths: Set<string>) => void,
  rev: number,
): Promise<void> {
  try {
    const res = await fetch('/api/links/graph');
    if (!res.ok) return;
    const { nodes } = await res.json() as { nodes: Array<{ id: string; tags: string[] }> };

    // Aggregate: tag → set of page paths
    const tagMap = new Map<string, string[]>();
    for (const node of nodes) {
      for (const tag of (node.tags ?? [])) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag)!.push(node.id);
      }
    }

    if (tagMap.size === 0) return;

    const body = document.createElement('div');
    body.className = 'sidebar-tags-list';

    const sorted = [...tagMap.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [tag, pages] of sorted) {
      const chip = document.createElement('button');
      chip.className = `sidebar-tag-chip${activeTag === tag ? ' active' : ''}`;
      chip.type = 'button';
      chip.textContent = '';
      const label = document.createElement('span');
      label.className = 'tag-label';
      label.textContent = tag;
      const count = document.createElement('span');
      count.className = 'tag-count';
      count.textContent = String(pages.length);
      chip.appendChild(label);
      chip.appendChild(count);
      chip.addEventListener('click', () => {
        if (activeTag === tag) {
          // Clicking the active tag clears the filter
          onTagClick(null, new Set());
        } else {
          onTagClick(tag, new Set(pages));
        }
      });
      body.appendChild(chip);
    }

    if (_renderRev !== rev) return;
    containerEl.appendChild(buildSection(`Tags (${tagMap.size})`, body, true));
  } catch { /* silent */ }
}

// ── Trash tray ────────────────────────────────────────────────────────────────

async function buildTrashSection(
  container: HTMLElement,
  onRefresh: () => Promise<void>,
  rev: number,
): Promise<void> {
  try {
    const res = await fetch('/api/trash');
    if (!res.ok) return;
    const items = (await res.json()) as Array<{ id: string; name: string; deletedAt: string }>;
    if (items.length === 0) return;

    const body = document.createElement('div');
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'trash-item';
      const name = document.createElement('span');
      name.className = 'trash-name';
      name.textContent = item.name;
      const actions = document.createElement('span');
      actions.className = 'trash-actions';

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'trash-btn';
      restoreBtn.title = 'Restore';
      restoreBtn.textContent = '↩';
      restoreBtn.addEventListener('click', async () => {
        try {
          const r = await fetch(`/api/trash/restore/${item.id}`, { method: 'POST' });
          if (!r.ok) { showToast(`Restore failed: ${((await r.json()) as { error: string }).error}`, 'error', 4000); return; }
          await onRefresh();
        } catch (err) {
          showToast(`Restore failed: ${String(err)}`, 'error', 4000);
        }
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'trash-btn danger';
      delBtn.title = 'Delete permanently';
      delBtn.textContent = '🗑';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Permanently delete "${item.name}"?`)) return;
        try {
          const r = await fetch(`/api/trash/${item.id}`, { method: 'DELETE' });
          if (!r.ok) { showToast('Permanent delete failed', 'error', 4000); return; }
          await onRefresh();
        } catch (err) {
          showToast(`Permanent delete failed: ${String(err)}`, 'error', 4000);
        }
      });

      actions.append(restoreBtn, delBtn);
      row.append(name, actions);
      body.appendChild(row);
    }
    if (_renderRev !== rev) return;
    container.appendChild(buildSection(`Trash (${items.length})`, body, true));
  } catch { /* silent */ }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Recursively keep only file nodes whose path is in `paths`, and folders
 *  that have at least one such descendant. */
export function filterNodesByPaths(nodes: PageNode[], paths: Set<string>): PageNode[] {
  const out: PageNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (paths.has(node.path)) out.push(node);
    } else {
      const children = filterNodesByPaths(node.children ?? [], paths);
      if (children.length > 0) out.push({ ...node, children });
    }
  }
  return out;
}

export function findNodeByPath(nodes: PageNode[], targetPath: string): PageNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

export function sortNodes(a: PageNode, b: PageNode): number {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

// ── Emoji picker (#95) ────────────────────────────────────────────────────────

let _sidebarPickerClose: ((e: MouseEvent) => void) | null = null;
let _sidebarPickerKeyDown: ((e: KeyboardEvent) => void) | null = null;

const COMMON_EMOJIS = [
  '📄','📝','📋','📌','📎','📃','📜','📑','🗒','🗓',
  '📅','📆','📊','📈','📉','🗃','🗂','📁','📂','🗄',
  '💡','⚡','🔧','🔨','⚙️','🛠','🔍','🔎','🔑','🗝',
  '🎯','🚀','✅','❌','⭐','🌟','💎','🏅','🎖','🏆',
  '💬','📢','📣','ℹ️','⚠️','❓','❗','📰','📖','📚',
  '🌍','🌐','🔗','📡','💻','🖥','🖨','⌨️','🖱','📱',
  '🎨','🎭','🎬','🎵','🎸','🎹','🎮','🕹','🃏','🎲',
  '🌱','🌿','🍀','🌸','🌺','🦋','🐾','🦊','🐶','🐱',
];

function openEmojiPicker(
  anchor: HTMLElement,
  pagePath: string,
  onPick: (emoji: string) => void,
): void {
  // Remove any lingering previous close listeners
  if (_sidebarPickerClose) {
    document.removeEventListener('mousedown', _sidebarPickerClose, { capture: true });
    _sidebarPickerClose = null;
  }
  if (_sidebarPickerKeyDown) {
    document.removeEventListener('keydown', _sidebarPickerKeyDown, { capture: true });
    _sidebarPickerKeyDown = null;
  }

  // Close existing picker
  document.querySelector('.emoji-picker-popover')?.remove();

  const popover = document.createElement('div');
  popover.className = 'emoji-picker-popover';

  const grid = document.createElement('div');
  grid.className = 'emoji-picker-grid';

  for (const emoji of COMMON_EMOJIS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-picker-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      onPick(emoji);
      popover.remove();
      if (_sidebarPickerClose) {
        document.removeEventListener('mousedown', _sidebarPickerClose, { capture: true });
        _sidebarPickerClose = null;
      }
      if (_sidebarPickerKeyDown) {
        document.removeEventListener('keydown', _sidebarPickerKeyDown, { capture: true });
        _sidebarPickerKeyDown = null;
      }
      // Persist icon to frontmatter via PATCH-like PUT
      void updatePageIcon(pagePath, emoji);
    });
    grid.appendChild(btn);
  }

  popover.appendChild(grid);
  document.body.appendChild(popover);

  // Position below anchor
  const rect = anchor.getBoundingClientRect();
  popover.style.left = `${rect.left}px`;
  popover.style.top  = `${rect.bottom + 4}px`;

  // Close on outside click or Escape
  const close = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node) && !(e.target as Node).isEqualNode(anchor)) {
      popover.remove();
      document.removeEventListener('mousedown', close, { capture: true });
      document.removeEventListener('keydown', handleKey, { capture: true });
      _sidebarPickerClose = null;
      _sidebarPickerKeyDown = null;
    }
  };
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      popover.remove();
      document.removeEventListener('mousedown', close, { capture: true });
      document.removeEventListener('keydown', handleKey, { capture: true });
      _sidebarPickerClose = null;
      _sidebarPickerKeyDown = null;
    }
  };
  _sidebarPickerClose = close;
  _sidebarPickerKeyDown = handleKey;
  setTimeout(() => {
    document.addEventListener('mousedown', close, { capture: true });
    document.addEventListener('keydown', handleKey, { capture: true });
  }, 0);
}

async function updatePageIcon(path: string, icon: string): Promise<void> {
  try {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`/api/pages/${encoded}`);
    if (!res.ok) return;
    const { content } = await res.json() as { content: string };

    let updated: string;
    const fmMatch = /^(---\r?\n)([\s\S]*?)(\n---)/.exec(content);
    if (fmMatch) {
      const fmBody = fmMatch[2]!;
      if (/^icon:/m.test(fmBody)) {
        // Replace existing icon key
        updated = content.replace(/^icon:.*$/m, `icon: "${icon}"`);
      } else {
        // Insert after the opening ---
        updated = content.replace(/^(---\r?\n)/, `$1icon: "${icon}"\n`);
      }
    } else {
      // No frontmatter — prepend one
      updated = `---\nicon: "${icon}"\n---\n${content}`;
    }

    const putRes = await fetch(`/api/pages/${encoded}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: updated }),
    });
    // icon save failed — silent best-effort
  } catch { /* silent */ }
}
