// src/client/sidebar/index.ts
// Sidebar: Favorites, Recent, page tree with context menu, inline rename,
// drag-and-drop move, and Trash tray.

export interface PageNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
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

// ── localStorage helpers ──────────────────────────────────────────────────────

function getFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem('qs_favorites') ?? '[]') as string[]; }
  catch { return []; }
}
function setFavorites(favs: string[]): void {
  localStorage.setItem('qs_favorites', JSON.stringify(favs));
}
function isFavorite(path: string): boolean { return getFavorites().includes(path); }
function toggleFavorite(path: string): void {
  const favs = getFavorites();
  const i = favs.indexOf(path);
  if (i >= 0) { favs.splice(i, 1); } else { favs.push(path); }
  setFavorites(favs);
}

function getRecent(): Array<{ path: string; name: string }> {
  try { return JSON.parse(localStorage.getItem('qs_recent') ?? '[]') as Array<{ path: string; name: string }>; }
  catch { return []; }
}
export function addRecentPage(path: string, name: string): void {
  let recent = getRecent().filter(r => r.path !== path);
  recent.unshift({ path, name });
  recent = recent.slice(0, 10);
  localStorage.setItem('qs_recent', JSON.stringify(recent));
}

// ── Context menu ──────────────────────────────────────────────────────────────

type MenuItem = { label: string; action: () => void; danger?: boolean } | 'separator';
let _ctxMenu: HTMLElement | null = null;

function openContextMenu(e: MouseEvent, items: MenuItem[]): void {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  for (const item of items) {
    if (item === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
    } else {
      const btn = document.createElement('button');
      btn.className = `ctx-item${item.danger ? ' danger' : ''}`;
      btn.textContent = item.label;
      btn.addEventListener('mousedown', ev => ev.stopPropagation());
      btn.addEventListener('click', () => { closeContextMenu(); item.action(); });
      menu.appendChild(btn);
    }
  }
  document.body.appendChild(menu);
  _ctxMenu = menu;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = e.clientX, y = e.clientY;
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;visibility:hidden`;
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (x + r.width > vw) x = vw - r.width - 4;
    if (y + r.height > vh) y = vh - r.height - 4;
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px`;
    setTimeout(() => {
      document.addEventListener('mousedown', closeContextMenu, { once: true });
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeContextMenu(); }, { once: true });
    }, 0);
  });
}

function closeContextMenu(): void {
  _ctxMenu?.remove();
  _ctxMenu = null;
}

// ── Inline rename ─────────────────────────────────────────────────────────────

function startRename(
  labelEl: HTMLSpanElement,
  node: PageNode,
  onRefresh: () => Promise<void>,
): void {
  const input = document.createElement('input');
  input.className = 'tree-rename-input';
  input.value = node.name;
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;

  async function commit() {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (!newName || newName === node.name) { input.replaceWith(labelEl); return; }
    // Replace only the last path segment; .qmd suffix is handled server-side
    const parts = node.path.replace(/\\/g, '/').split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');
    try {
      const urlPath = node.path.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(`/api/pages/${urlPath}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPath }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      await onRefresh();
    } catch (err) {
      input.replaceWith(labelEl);
      sidebarToast(`Rename failed: ${String(err)}`);
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); void commit(); }
    if (e.key === 'Escape') { committed = true; input.replaceWith(labelEl); }
  });
  input.addEventListener('blur', () => void commit());
}

function sidebarToast(msg: string): void {
  const container = document.getElementById('toast-container');
  if (!container) { console.error(msg); return; }
  const t = document.createElement('div');
  t.className = 'toast error';
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── Collapsible section ───────────────────────────────────────────────────────

function buildSection(title: string, content: HTMLElement, startCollapsed = false): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'sidebar-section';
  const header = document.createElement('div');
  header.className = 'sidebar-section-header';
  const chevron = document.createElement('span');
  chevron.className = 'section-chevron';
  chevron.textContent = startCollapsed ? '▶' : '▼';
  const titleSpan = document.createElement('span');
  titleSpan.textContent = title;
  header.append(chevron, titleSpan);
  let collapsed = startCollapsed;
  content.classList.add('sidebar-section-body');
  if (collapsed) content.classList.add('hidden');
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    content.classList.toggle('hidden', collapsed);
    chevron.textContent = collapsed ? '▶' : '▼';
  });
  wrapper.append(header, content);
  return wrapper;
}

// ── Drag state ────────────────────────────────────────────────────────────────

let _dragPath: string | null = null;
let _dragName: string | null = null;

// ── Main export ───────────────────────────────────────────────────────────────

export async function initSidebar(
  containerEl: HTMLElement,
  onSelect: SelectCallback,
  options?: SidebarOptions,
): Promise<() => Promise<void>> {
  let allNodes: PageNode[] = [];

  const wrappedSelect: SelectCallback = (path, name) => {
    addRecentPage(path, name);
    onSelect(path, name);
  };

  async function refresh() {
    try {
      const res = await fetch('/api/pages');
      if (!res.ok) throw new Error('Server error');
      allNodes = (await res.json()) as PageNode[];
    } catch {
      containerEl.innerHTML = '<p class="sidebar-error">Failed to load pages.</p>';
      return;
    }
    render();
  }

  function render() {
    containerEl.innerHTML = '';
    const activePath = options?.getActivePath?.() ?? null;

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

    // Pages tree
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

    for (const node of [...allNodes].sort(sortNodes)) {
      treeEl.appendChild(buildNode(node, wrappedSelect, options, refresh, activePath, 0));
    }
    containerEl.appendChild(treeEl);

    // Trash tray (async, appends itself when ready)
    void buildTrashSection(containerEl, refresh);
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
  item.dataset.path = node.path;
  item.draggable = true;
  item.style.paddingLeft = `${16 + depth * 14}px`;

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = '○';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.name;

  item.append(icon, label);

  item.addEventListener('click', e => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
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
  wrapper.dataset.folderPath = node.path;

  const item = document.createElement('div');
  item.className = 'tree-item folder';
  item.style.paddingLeft = `${16 + depth * 14}px`;

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
    opts?.onDelete?.(node.path, node.type);
    await onRefresh();
  } catch (err) {
    sidebarToast(`Delete failed: ${String(err)}`);
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
    sidebarToast(`Move failed: ${String(err)}`);
  }
}

// ── Trash tray ────────────────────────────────────────────────────────────────

async function buildTrashSection(
  container: HTMLElement,
  onRefresh: () => Promise<void>,
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
        const r = await fetch(`/api/trash/restore/${item.id}`, { method: 'POST' });
        if (r.ok) { await onRefresh(); }
        else { sidebarToast(`Restore failed: ${((await r.json()) as { error: string }).error}`); }
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'trash-btn danger';
      delBtn.title = 'Delete permanently';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Permanently delete "${item.name}"?`)) return;
        const r = await fetch(`/api/trash/${item.id}`, { method: 'DELETE' });
        if (r.ok) { await onRefresh(); }
        else { sidebarToast('Permanent delete failed'); }
      });

      actions.append(restoreBtn, delBtn);
      row.append(name, actions);
      body.appendChild(row);
    }
    container.appendChild(buildSection(`Trash (${items.length})`, body, true));
  } catch { /* silent */ }
}

// ── Favorites / Recent lists ──────────────────────────────────────────────────

function buildSimpleList(
  nodes: PageNode[],
  onSelect: SelectCallback,
  activePath: string | null,
  iconChar: string,
): HTMLElement {
  const list = document.createElement('div');
  for (const node of nodes) {
    const item = document.createElement('div');
    item.className = `tree-item file${activePath === node.path ? ' active' : ''}`;
    item.style.paddingLeft = '16px';
    const icon = document.createElement('span');
    icon.className = 'icon'; icon.textContent = iconChar;
    const label = document.createElement('span');
    label.className = 'label'; label.textContent = node.name;
    item.append(icon, label);
    item.addEventListener('click', () => {
      document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      onSelect(node.path, node.name);
    });
    list.appendChild(item);
  }
  return list;
}

function buildRecentList(
  recent: Array<{ path: string; name: string }>,
  onSelect: SelectCallback,
  activePath: string | null,
): HTMLElement {
  const list = document.createElement('div');
  for (const entry of recent.slice(0, 5)) {
    const item = document.createElement('div');
    item.className = `tree-item file${activePath === entry.path ? ' active' : ''}`;
    item.style.paddingLeft = '16px';
    const icon = document.createElement('span');
    icon.className = 'icon'; icon.textContent = '↵';
    const label = document.createElement('span');
    label.className = 'label'; label.textContent = entry.name;
    item.append(icon, label);
    item.addEventListener('click', () => {
      document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      onSelect(entry.path, entry.name);
    });
    list.appendChild(item);
  }
  return list;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function findNodeByPath(nodes: PageNode[], targetPath: string): PageNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

function sortNodes(a: PageNode, b: PageNode): number {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name);
}
