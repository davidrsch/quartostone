// src/client/main.ts
// Application entry point — wires sidebar, editor, git panel, properties panel.

import { createEditor, connectLiveReload } from './editor/index.js';
import { createVisualEditor } from './visual/index.js';
import type { VisualEditorInstance } from './visual/index.js';
import { initDatabaseView } from './database/index.js';
import type { DbInstance } from './database/index.js';
import { initSidebar, addRecentPage } from './sidebar/index.js';
import { initGitPanel } from './git/index.js';
import { createPropertiesPanel } from './properties/index.js';
import { initBranchPicker } from './branches/index.js';
import type { BranchPickerResult } from './branches/index.js';
import { initHistoryPanel } from './history/index.js';
import { initExportPicker } from './export/index.js';
import { initPreviewPanel } from './preview/index.js';
import type { PreviewPanel } from './preview/index.js';
import { initBacklinksPanel } from './backlinks/index.js';
import type { BacklinksPanel } from './backlinks/index.js';
import { initSearchOverlay } from './search/index.js';
import { initGraphPanel } from './graph/index.js';
import type { EditorView } from '@codemirror/view';
import { applyTheme, toggleTheme, storeTheme, resolveInitialTheme } from './theme.js';
import { filterEntries, moveIdx } from './cmdpalette/filter.js';
import type { PaletteEntry } from './cmdpalette/filter.js';
import { renderBreadcrumb as _renderBreadcrumb } from './breadcrumb.js';

// ─── DOM references ───────────────────────────────────────────────────────────
const fileTreeEl       = document.getElementById('file-tree')!;
const editorMountEl    = document.getElementById('editor-mount')!;
const noPageMessageEl  = document.getElementById('no-page-message')!;
const pageTitleEl      = document.getElementById('current-page-title')!;
const btnSave          = document.getElementById('btn-save') as HTMLButtonElement;
const btnCommit        = document.getElementById('btn-commit') as HTMLButtonElement;
const btnNewPage       = document.getElementById('btn-new-page') as HTMLButtonElement;
const btnNewDb         = document.getElementById('btn-new-db') as HTMLButtonElement;
const btnModeSource    = document.getElementById('btn-mode-source') as HTMLButtonElement;
const btnModeVisual    = document.getElementById('btn-mode-visual') as HTMLButtonElement;
const btnProperties    = document.getElementById('btn-properties') as HTMLButtonElement;
const btnCloseProps    = document.getElementById('btn-close-props') as HTMLButtonElement;
const propertiesPanel  = document.getElementById('properties-panel')!;
const propertiesBody   = document.getElementById('properties-body')!;
const gitPanelEl       = document.getElementById('git-panel')!;
const historyPanelEl   = document.getElementById('history-panel')!;
const toastContainer   = document.getElementById('toast-container')!;
const commitDialog     = document.getElementById('commit-dialog') as HTMLDialogElement;
const commitMsgInput   = document.getElementById('commit-msg') as HTMLInputElement;
const btnCommitConfirm = document.getElementById('btn-commit-confirm') as HTMLButtonElement;
const btnCommitCancel  = document.getElementById('btn-commit-cancel') as HTMLButtonElement;
const sbBranch         = document.getElementById('sb-branch')!;
const sbSync           = document.getElementById('sb-sync')!;
const sbRenderStatus   = document.getElementById('sb-render-status')!;
const sbSaveStatus     = document.getElementById('sb-save-status')!;
const editorMount2El   = document.getElementById('editor-mount-2')!;
const editorSplitEl    = document.getElementById('editor-split')!;
const btnSplit         = document.getElementById('btn-split') as HTMLButtonElement;

// L-2: named-input dialogs (replace window.prompt)
const newPageDialog    = document.getElementById('new-page-dialog') as HTMLDialogElement;
const newPageNameInput = document.getElementById('new-page-name') as HTMLInputElement;
const btnNewPageConfirm = document.getElementById('btn-new-page-confirm') as HTMLButtonElement;
const btnNewPageCancel  = document.getElementById('btn-new-page-cancel') as HTMLButtonElement;
const newFolderDialog    = document.getElementById('new-folder-dialog') as HTMLDialogElement;
const newFolderNameInput = document.getElementById('new-folder-name') as HTMLInputElement;
const btnNewFolderConfirm = document.getElementById('btn-new-folder-confirm') as HTMLButtonElement;
const btnNewFolderCancel  = document.getElementById('btn-new-folder-cancel') as HTMLButtonElement;
const btnNewFolder       = document.getElementById('btn-new-folder') as HTMLButtonElement;
const newDbDialog      = document.getElementById('new-db-dialog') as HTMLDialogElement;
const newDbNameInput   = document.getElementById('new-db-name') as HTMLInputElement;
const btnNewDbConfirm  = document.getElementById('btn-new-db-confirm') as HTMLButtonElement;
const btnNewDbCancel   = document.getElementById('btn-new-db-cancel') as HTMLButtonElement;

// ─── State ────────────────────────────────────────────────────────────────────
let activeView: EditorView | null = null;
let activeVisual: VisualEditorInstance | null = null;
let activeDb: DbInstance | null = null;
let activePath: string | null = null;
let isDirty = false;
let editorMode: 'source' | 'visual' = 'source';
let refreshSidebar: (() => Promise<void>) | null = null;
let refreshGit: (() => Promise<void>) | null = null;
let branchPicker: BranchPickerResult | null = null;
let historySetPage: ((path: string | null) => void) | null = null;
let previewPanel: PreviewPanel | null = null;
let backlinksPanel: BacklinksPanel | null = null;
let graphView: { open(): void; close(): void; refresh(): void } | null = null;
let switchingMode = false; // M-4: guard against concurrent mode switches
let visualMarkdownCache = ''; // last-known markdown when visual editor is active

// ─── Split pane state (#140) ──────────────────────────────────────────────────
let splitActive = false;
let focusedPane: 'primary' | 'secondary' = 'primary';
let activeView2: EditorView | null = null;
let activePath2: string | null = null;

const propsPanel = createPropertiesPanel(propertiesBody);

// ─── Toast helper ─────────────────────────────────────────────────────────────
type ToastKind = 'info' | 'success' | 'error';

function showToast(message: string, kind: ToastKind = 'info', duration = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
  return toast;
}

function showCommitPrompt(autoSlug: string) {
  const toast = document.createElement('div');
  toast.className = 'toast info';
  toast.innerHTML = `<span>Rendered — commit changes?</span>`;
  const actions = document.createElement('div');
  actions.className = 'toast-actions';
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Commit';
  confirmBtn.addEventListener('click', () => { toast.remove(); clearTimeout(autoCommitTimer); openCommitDialog(autoSlug); });
  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => { toast.remove(); clearTimeout(autoCommitTimer); });
  actions.append(confirmBtn, dismissBtn);
  toast.appendChild(actions);
  toastContainer.appendChild(toast);
  // M-3: if the user ignores the toast for 30 s, auto-commit with the slug
  const autoCommitTimer = setTimeout(async () => {
    if (!toast.parentNode) return; // user already acted
    toast.remove();
    try {
      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: autoSlug }),
      });
      if (res.ok) {
        showToast(`Auto-committed: ${autoSlug}`, 'info');
        refreshGit?.();
        branchPicker?.refresh();
        updateBranchStatus();
      }
    } catch { /* silent best-effort */ }
  }, 30000);
}

// ─── Commit dialog ────────────────────────────────────────────────────────────
function openCommitDialog(defaultMsg = '') {
  commitMsgInput.value = defaultMsg;
  commitDialog.showModal();
  commitMsgInput.select();
}

btnCommitConfirm.addEventListener('click', async () => {
  const message = commitMsgInput.value.trim();
  if (!message) return;
  commitDialog.close();
  try {
    const res = await fetch('/api/git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error((await res.json() as { error: string }).error);
    showToast(`Committed: ${message}`, 'success');
    await refreshGit?.();
    await branchPicker?.refresh();
    updateBranchStatus();
    if (activePath) {
      const panel = historyPanelEl as HTMLElement & { refreshHistory?: () => void };
      panel.refreshHistory?.();
    }
  } catch (e) {
    showToast(`Commit failed: ${String(e)}`, 'error');
  }
});

btnCommitCancel.addEventListener('click', () => commitDialog.close());

// ─── Editor mode toggle ──────────────────────────────────────────────────────
async function switchMode(mode: 'source' | 'visual') {
  if (mode === editorMode) return;
  if (!activePath) return;
  // M-4: prevent concurrent mode switches spawning duplicate editors
  if (switchingMode) return;
  switchingMode = true;
  try {
    if (mode === 'visual') {
    // Get current source content, destroy source editor, init visual
    const markdown = activeView ? activeView.state.doc.toString() : '';
    visualMarkdownCache = markdown;
    activeView?.destroy();
    activeView = null;
    editorMountEl.innerHTML = '';

    activeVisual = await createVisualEditor({
      container: editorMountEl,
      initialMarkdown: markdown,
      documentPath: activePath,
      onDirty: () => {
        isDirty = true;
        btnSave.disabled = false;
        sbSaveStatus.textContent = 'Unsaved changes';
        // update cache asynchronously so properties panel stays mostly fresh
        activeVisual?.getMarkdown().then(md => { visualMarkdownCache = md; }).catch(() => {});
      },
    });

    editorMode = 'visual';
    btnModeSource.classList.remove('active');
    btnModeVisual.classList.add('active');
  } else {
    // Get current visual content, destroy visual editor, init source
    const markdown = activeVisual ? await activeVisual.getMarkdown() : visualMarkdownCache;
    visualMarkdownCache = '';
    activeVisual?.destroy();
    activeVisual = null;
    editorMountEl.innerHTML = '';

    activeView = await createEditor({
      container: editorMountEl,
      pagePath: activePath,
      onSave: () => {
        isDirty = false;
        btnSave.disabled = true;
        sbSaveStatus.textContent = 'Saved';
        setTimeout(() => { sbSaveStatus.textContent = ''; }, 2000);
        refreshGit?.();
        updateBranchStatus();
      },
      onSaveError: (err) => {
        showToast(`Auto-save failed: ${err.message}`, 'error');
        sbSaveStatus.textContent = '';
      },
      onDirty: () => {
        isDirty = true;
        btnSave.disabled = false;
        sbSaveStatus.textContent = 'Unsaved changes';
      },
    });

    // Inject markdown from visual editor into source editor
    if (markdown && activeView) {
      const { dispatch, state } = activeView;
      dispatch(state.update({
        changes: { from: 0, to: state.doc.length, insert: markdown },
      }));
    }

    editorMode = 'source';
    btnModeSource.classList.add('active');
    btnModeVisual.classList.remove('active');
  }
  } finally {
    switchingMode = false;
  }
}

btnModeSource.addEventListener('click', () => switchMode('source'));
btnModeVisual.addEventListener('click', () => switchMode('visual'));

// ─── Sidebar tabs ─────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.stab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.stab-panel').forEach(p => p.classList.add('hidden'));
    tab.classList.add('active');
    const panelId = `tab-${tab.dataset.tab}`;
    document.getElementById(panelId)?.classList.remove('hidden');
  });
});

// ─── Properties panel ─────────────────────────────────────────────────────────
btnProperties.addEventListener('click', () => {
  const hidden = propertiesPanel.classList.toggle('hidden');
  btnProperties.classList.toggle('active', !hidden);
  if (!hidden && activePath) {
    const getContent = () =>
      editorMode === 'visual' && activeVisual
        ? visualMarkdownCache
        : (activeView ? activeView.state.doc.toString() : '');
    const setContent = (newContent: string) => {
      if (editorMode === 'source' && activeView) {
        const { dispatch, state } = activeView;
        dispatch(state.update({
          changes: { from: 0, to: state.doc.length, insert: newContent },
        }));
      } else if (editorMode === 'visual' && activeVisual) {
        // M-2: push frontmatter edits back into the visual editor
        void activeVisual.setMarkdown(newContent);
      }
    };
    propsPanel.mount(activePath, getContent, setContent);
  }
});

btnCloseProps.addEventListener('click', () => {
  propertiesPanel.classList.add('hidden');
  btnProperties.classList.remove('active');
  propsPanel.unmount();
});

// ─── Toolbar ──────────────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  if (!activePath) return;
  await saveCurrentPage();
});

btnCommit.addEventListener('click', () => {
  const slug = `qs-${Math.random().toString(36).slice(2, 10)}`;
  openCommitDialog(slug);
});

btnNewPage.addEventListener('click', () => {
  newPageNameInput.value = '';
  newPageDialog.showModal();
  newPageNameInput.focus();
});

btnNewFolder.addEventListener('click', () => {
  newFolderNameInput.value = '';
  newFolderDialog.showModal();
  newFolderNameInput.focus();
});

/** L-3: validate a user-supplied page name */
function validatePageName(name: string): string | null {
  const trimmed = name.trim().replace(/^\/+/, '');
  if (!trimmed) return null;
  if (trimmed.includes('\0')) return null;
  return trimmed;
}

btnNewPageCancel.addEventListener('click', () => newPageDialog.close());
btnNewPageConfirm.addEventListener('click', async () => {
  const name = validatePageName(newPageNameInput.value);
  newPageDialog.close();
  if (!name) { showToast('Page name is invalid', 'error'); return; }
  try {
    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: name }),
    });
    if (!res.ok) throw new Error((await res.json() as { error: string }).error);
    await refreshSidebar?.();
    showToast(`Created ${name}.qmd`, 'success');
  } catch (e) {
    showToast(`Failed: ${String(e)}`, 'error');
  }
});

btnNewFolderCancel.addEventListener('click', () => newFolderDialog.close());
btnNewFolderConfirm.addEventListener('click', async () => {
  const raw = newFolderNameInput.value.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  newFolderDialog.close();
  if (!raw) { showToast('Folder name is invalid', 'error'); return; }
  try {
    const res = await fetch('/api/directories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: raw }),
    });
    if (!res.ok) throw new Error((await res.json() as { error: string }).error);
    await refreshSidebar?.();
    showToast(`Created folder ${raw}`, 'success');
  } catch (e) {
    showToast(`Failed: ${String(e)}`, 'error');
  }
});

btnNewDb.addEventListener('click', () => {
  newDbNameInput.value = '';
  newDbDialog.showModal();
  newDbNameInput.focus();
});

btnNewDbCancel.addEventListener('click', () => newDbDialog.close());
btnNewDbConfirm.addEventListener('click', async () => {
  const rawName = newDbNameInput.value.trim();
  newDbDialog.close();
  if (!rawName) { showToast('Database name is invalid', 'error'); return; }
  const slug = rawName.replace(/\s+/g, '-').toLowerCase();
  const path = `pages/${slug}.qmd`;
  try {
    const res = await fetch(`/api/db/create?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: rawName }),
    });
    if (!res.ok) throw new Error((await res.json() as { error: string }).error);
    await refreshSidebar?.();
    showToast(`Created database ${rawName}`, 'success');
    openPage(path, rawName);
  } catch (e) {
    showToast(`Failed: ${String(e)}`, 'error');
  }
});

// ─── Save ─────────────────────────────────────────────────────────────────────
async function saveCurrentPage() {
  if (!activePath) return;
  if (activeDb) return; // Database auto-saves on cell change
  const content = editorMode === 'visual' && activeVisual
    ? await activeVisual.getMarkdown()
    : (activeView ? activeView.state.doc.toString() : '');
  if (content == null) return;
  sbSaveStatus.textContent = 'Saving…';
  try {
    await fetch(`/api/pages/${encodeURIComponent(activePath)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    isDirty = false;
    btnSave.disabled = true;
    sbSaveStatus.textContent = 'Saved';
    setTimeout(() => { sbSaveStatus.textContent = ''; }, 2000);
  } catch {
    showToast('Save failed', 'error');
    sbSaveStatus.textContent = '';
  }
}

// ─── Status bar ───────────────────────────────────────────────────────────────
async function updateBranchStatus() {
  try {
    const res = await fetch('/api/git/status');
    const s = await res.json() as { current: string; files: unknown[]; ahead: number; behind: number };
    const dirty = s.files.length > 0;
    sbBranch.textContent = `⎇ ${s.current}${dirty ? ` · ${s.files.length} changed` : ''}`;
    sbBranch.className = dirty ? 'sb-dirty' : '';
    // Populate ahead/behind sync indicator
    const syncParts: string[] = [];
    if (s.ahead  > 0) syncParts.push(`↑${s.ahead}`);
    if (s.behind > 0) syncParts.push(`↓${s.behind}`);
    sbSync.textContent = syncParts.join(' ');
    sbSync.classList.toggle('hidden', syncParts.length === 0);
  } catch {
    sbBranch.textContent = '';
    sbSync.textContent = '';
    sbSync.classList.add('hidden');
  }
}

// ─── Breadcrumb navigation (#139) ────────────────────────────────────────────
// Thin wrapper that binds the module-level DOM element and sidebar reference
// to the pure renderBreadcrumb function from breadcrumb.ts.
function renderBreadcrumb(path: string | null): void {
  const el = document.getElementById('editor-breadcrumb') as HTMLElement | null;
  if (!el) return;
  _renderBreadcrumb(path, el, (segPath) => {
    const target = fileTreeEl.querySelector<HTMLElement>(`[data-path="${segPath}"]`);
    if (target) {
      target.scrollIntoView({ block: 'nearest' });
      target.focus();
      target.click();
    }
  });
}

// ─── Editor load ────────────────────────────────────────────────────────────── 
async function openPage(path: string, name: string) {  // M-1: guard against silently discarding unsaved changes
  if (isDirty) {
    const discard = confirm('You have unsaved changes. Discard them?');
    if (!discard) return;
  }
  // Destroy any active editor
  activeView?.destroy(); activeView = null;
  activeVisual?.destroy(); activeVisual = null;
  activeDb?.destroy(); activeDb = null;
  editorMountEl.innerHTML = '';

  activePath = path;
  renderBreadcrumb(path);
  isDirty = false;
  pageTitleEl.textContent = name;
  noPageMessageEl.classList.remove('visible');
  btnSave.disabled = true;
  btnCommit.disabled = false;
  (document.getElementById('btn-export') as HTMLButtonElement & { pageReady: boolean }).pageReady = true;

  // Check if this is a database page
  const dbInstance = await initDatabaseView(editorMountEl, path);
  if (dbInstance) {
    activeDb = dbInstance;
    // Hide mode toggle buttons — database has its own view switcher
    btnModeSource.style.display = 'none';
    btnModeVisual.style.display = 'none';
    return;
  }

  // Show mode toggle buttons for regular pages
  btnModeSource.style.display = '';
  btnModeVisual.style.display = '';

  if (editorMode === 'visual') {
    // Fetch content then open in visual mode — C-2: add error handling
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { content?: string };
      activeVisual = await createVisualEditor({
        container: editorMountEl,
        initialMarkdown: data.content ?? '',
        documentPath: path,
        onDirty: () => {
          isDirty = true;
          btnSave.disabled = false;
          sbSaveStatus.textContent = 'Unsaved changes';
        },
      });
    } catch (e) {
      showToast(`Failed to load page: ${String(e)}`, 'error');
      noPageMessageEl.classList.add('visible');
      activePath = null;
      renderBreadcrumb(null);
    }
  } else {
    activeView = await createEditor({
      container: editorMountEl,
      pagePath: path,
      onSave: () => {
        isDirty = false;
        btnSave.disabled = true;
        sbSaveStatus.textContent = 'Saved';
        setTimeout(() => { sbSaveStatus.textContent = ''; }, 2000);
        refreshGit?.();
        updateBranchStatus();
      },
      onSaveError: (err) => {
        showToast(`Auto-save failed: ${err.message}`, 'error');
        sbSaveStatus.textContent = '';
      },
      onDirty: () => {
        isDirty = true;
        btnSave.disabled = false;
        sbSaveStatus.textContent = 'Unsaved changes';
      },
    });
  }

  // Update history panel with newly opened page
  historySetPage?.(path);

  // Update preview panel with newly opened page
  previewPanel?.setPage(path);

  // Update backlinks panel with newly opened page
  backlinksPanel?.setPage(path);

  // Re-mount properties panel if open
  if (!propertiesPanel.classList.contains('hidden')) {
    const getContent = () =>
      editorMode === 'visual' && activeVisual
        ? activeVisual.getMarkdown()
        : (activeView ? activeView.state.doc.toString() : '');
    const setContent = (newContent: string) => {
      if (editorMode === 'source' && activeView) {
        const { dispatch, state } = activeView;
        dispatch(state.update({ changes: { from: 0, to: state.doc.length, insert: newContent } }));
      } else if (editorMode === 'visual' && activeVisual) {
        // M-2: push frontmatter edits back into the visual editor
        activeVisual.setMarkdown(newContent);
      }
    };
    propsPanel.mount(path, getContent, setContent);
  }
}

// ─── #140 Split editor helpers ────────────────────────────────────────────────

/** Set which pane is "focused" — sidebar nav routes into it. */
function setFocusedPane(pane: 'primary' | 'secondary') {
  focusedPane = pane;
  const primaryEl  = document.getElementById('editor-pane-primary');
  const secondaryEl = document.getElementById('editor-pane-secondary');
  primaryEl?.classList.toggle('focused-pane', pane === 'primary');
  secondaryEl?.classList.toggle('focused-pane', pane === 'secondary');
}

/** Open a file in the secondary pane (source-only). */
async function openPageInPane2(path: string, name: string): Promise<void> {
  activeView2?.destroy();
  activeView2 = null;
  editorMount2El.innerHTML = '';
  activePath2 = path;

  try {
    activeView2 = await createEditor({
      container: editorMount2El,
      pagePath: path,
      onSave: () => {
        markTabDirty2(path, false);
      },
      onSaveError: (err) => {
        showToast(`Pane 2 auto-save failed: ${err.message}`, 'error');
      },
      onDirty: () => {
        markTabDirty2(path, true);
      },
    });
  } catch (e) {
    showToast(`Failed to load in split pane: ${String(e)}`, 'error');
    activePath2 = null;
    return;
  }
  ensureTab2(path, name);
}

/** Destroy the secondary pane editor and clear its state. */
function closeSplitPane(): void {
  activeView2?.destroy();
  activeView2 = null;
  activePath2 = null;
  openTabs2.length = 0;
  activeTabPath2 = null;
  editorMount2El.innerHTML = '';
  renderTabBar2();
}

/** Activate or deactivate the split-editor view. */
function toggleSplit(): void {
  splitActive = !splitActive;
  editorSplitEl.classList.toggle('split-active', splitActive);
  const divider = document.getElementById('editor-pane-divider')!;
  divider.classList.toggle('hidden', !splitActive);
  btnSplit.setAttribute('aria-pressed', String(splitActive));
  btnSplit.classList.toggle('active', splitActive);

  if (splitActive) {
    // When opening, clone the current primary file into pane 2 (if any is open)
    setFocusedPane('primary');
    if (activePath) {
      void openPageInPane2(activePath, pageTitleEl.textContent ?? activePath);
    }
  } else {
    closeSplitPane();
    setFocusedPane('primary');
  }
}

// ─── Live reload (WebSocket) ──────────────────────────────────────────────────
connectLiveReload((event, data) => {
  if (event === 'render:complete') {
    sbRenderStatus.textContent = 'Rendered ✓';
    setTimeout(() => { sbRenderStatus.textContent = ''; }, 3000);
  }
  if (event === 'git:prompt') {
    const d = data as { autoSlug?: string };
    showCommitPrompt(d.autoSlug ?? 'qs-xxxxxxxx');
  }
  if (event === 'git:committed') {
    refreshGit?.();
    branchPicker?.refresh();
    updateBranchStatus();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
initSidebar(fileTreeEl, (path, name) => {
  addRecentPage(path, name);
  if (splitActive && focusedPane === 'secondary') {
    void openPageInPane2(path, name);
  } else {
    setFocusedPane('primary');
    void openPage(path, name);
  }
}, {
  onNewPage(folderPath) {
    newPageNameInput.value = folderPath ? `${folderPath}/` : '';
    newPageDialog.showModal();
    newPageNameInput.focus();
    newPageNameInput.setSelectionRange(newPageNameInput.value.length, newPageNameInput.value.length);
  },
  onNewFolder(folderPath) {
    newFolderNameInput.value = folderPath ? `${folderPath}/` : '';
    newFolderDialog.showModal();
    newFolderNameInput.focus();
    newFolderNameInput.setSelectionRange(newFolderNameInput.value.length, newFolderNameInput.value.length);
  },
  onDelete(path) {
    const cleanPath = path.endsWith('.qmd') ? path : `${path}.qmd`;
    if (activePath && (activePath === path || activePath === cleanPath)) {
      activePath = null;
      renderBreadcrumb(null);
      activeView?.destroy(); activeView = null;
      activeVisual?.destroy(); activeVisual = null;
      activeDb?.destroy(); activeDb = null;
      editorMountEl.innerHTML = '';
      noPageMessageEl.classList.add('visible');
      pageTitleEl.textContent = '';
      btnSave.disabled = true;
      btnCommit.disabled = true;
    }
  },
  getActivePath: () => activePath,
}).then(refresh => { refreshSidebar = refresh; });

initGitPanel(gitPanelEl, openCommitDialog).then(({ refresh }) => { refreshGit = refresh; });

branchPicker = initBranchPicker((branch, stashConflict) => {
  updateBranchStatus();
  showToast(`Switched to branch "${branch}"`, 'success');
  if (stashConflict) showToast('Stash re-apply had conflicts — check your files', 'error', 6000);
  // Reload current page on branch switch so content reflects new branch
  if (activePath) openPage(activePath, pageTitleEl.textContent ?? activePath);
});

// ── Export picker ───────────────────────────────────────────────────────────
initExportPicker(() => activePath);

// ── Preview panel ────────────────────────────────────────────────────────────
previewPanel = initPreviewPanel();

// ── Backlinks panel ──────────────────────────────────────────────────────────
backlinksPanel = initBacklinksPanel(
  document.getElementById('backlinks-panel')!,
  (path, title) => openPage(path, title),
);

// ── Search overlay ───────────────────────────────────────────────────────────
const searchOverlay = initSearchOverlay((path, title) => openPage(path, title));

// ── Graph panel ──────────────────────────────────────────────────────────────
graphView = initGraphPanel(
  document.getElementById('graph-panel')!,
  (path, title) => openPage(path, title),
);
document.getElementById('btn-graph')?.addEventListener('click', () => graphView?.open());

initHistoryPanel(historyPanelEl, () => {
  // After a restore, reload the current page
  if (activePath) openPage(activePath, pageTitleEl.textContent ?? activePath);
  showToast('File restored to selected commit', 'success');
}).then(hp => { historySetPage = hp.setPage; });

// Click on ahead/behind badge → open Git panel
sbSync.addEventListener('click', () => {
  document.querySelector<HTMLButtonElement>('.stab[data-tab="git"]')?.click();
});

updateBranchStatus();

// Refresh git status every 30s
setInterval(updateBranchStatus, 30_000);

// Global keyboard shortcuts
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  // Ctrl+S — save
  if (mod && e.key === 's') {
    e.preventDefault();
    if (isDirty) saveCurrentPage();
  }
  // Ctrl+Shift+G — open commit dialog (L-1)
  if (mod && e.shiftKey && e.key === 'G') {
    e.preventDefault();
    if (activePath) openCommitDialog(`qs-${Math.random().toString(36).slice(2, 10)}`);
  }
  // Ctrl+Shift+E — toggle visual/source editor mode
  if (mod && e.shiftKey && e.key === 'E') {
    e.preventDefault();
    if (activePath && !activeDb) switchMode(editorMode === 'visual' ? 'source' : 'visual');
  }
  // Ctrl+Shift+P — toggle preview panel (L-1)
  if (mod && e.shiftKey && e.key === 'P') {
    e.preventDefault();
    document.getElementById('btn-preview')?.click();
  }
  // Ctrl+P — search pages overlay
  if (mod && !e.shiftKey && e.key === 'p') {
    e.preventDefault();
    searchOverlay.open();
  }
  // Ctrl+K — command palette (#113)
  if (mod && e.key === 'k') {
    e.preventDefault();
    openCmdPalette();
  }
  // Ctrl+\ — toggle split editor (#140)
  if (mod && e.key === '\\') {
    e.preventDefault();
    toggleSplit();
  }
  // Ctrl+Shift+B — toggle properties panel shortcut
  if (mod && e.shiftKey && e.key === 'B') {
    e.preventDefault();
    btnProperties.click();
  }
  // Escape — close command palette if open
  if (e.key === 'Escape') {
    if (!document.getElementById('cmd-palette')!.classList.contains('hidden')) {
      closeCmdPalette();
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-8: UX Polish and Accessibility
// ═══════════════════════════════════════════════════════════════════════════

// ─── #111 Resizable sidebar ───────────────────────────────────────────────────
{
  const sidebarEl = document.getElementById('sidebar') as HTMLElement;
  const resizer   = document.getElementById('sidebar-resizer') as HTMLElement;
  const SIDEBAR_W_KEY = 'qs_sidebar_width';
  const saved = localStorage.getItem(SIDEBAR_W_KEY);
  if (saved) sidebarEl.style.width = `${saved}px`;

  resizer?.addEventListener('mousedown', ev => {
    ev.preventDefault();
    resizer.classList.add('dragging');
    const startX = ev.clientX;
    const startW = sidebarEl.offsetWidth;
    const onMove = (e: MouseEvent) => {
      const w = Math.max(160, Math.min(600, startW + e.clientX - startX));
      sidebarEl.style.width = `${w}px`;
    };
    const onUp = () => {
      resizer.classList.remove('dragging');
      localStorage.setItem(SIDEBAR_W_KEY, String(sidebarEl.offsetWidth));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── #112 Tab bar ─────────────────────────────────────────────────────────────
interface TabEntry { path: string; name: string; dirty: boolean; }
const openTabs: TabEntry[] = [];
let activeTabPath: string | null = null;

function renderTabBar() {
  const bar = document.getElementById('tab-bar')!;
  bar.innerHTML = '';
  for (const tab of openTabs) {
    const el = document.createElement('div');
    el.className = 'editor-tab' + (tab.path === activeTabPath ? ' active' : '');
    el.title = tab.path;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(tab.path === activeTabPath));
    el.dataset.path = tab.path;

    const dot = document.createElement('span');
    dot.className = 'editor-tab-dot';
    dot.style.visibility = tab.dirty ? 'visible' : 'hidden';

    const name = document.createElement('span');
    name.className = 'editor-tab-name';
    name.textContent = tab.name;

    const close = document.createElement('button');
    close.className = 'editor-tab-close';
    close.title = 'Close tab';
    close.setAttribute('aria-label', `Close ${tab.name}`);
    close.textContent = '×';
    close.addEventListener('click', ev => {
      ev.stopPropagation();
      closeTab(tab.path);
    });

    el.append(dot, name, close);
    el.addEventListener('click', () => {
      if (tab.path !== activePath) openPage(tab.path, tab.name);
    });
    bar.appendChild(el);
  }
}

function ensureTab(path: string, name: string) {
  if (!openTabs.find(t => t.path === path)) {
    openTabs.push({ path, name, dirty: false });
  }
  activeTabPath = path;
  renderTabBar();
}

function closeTab(path: string) {
  const idx = openTabs.findIndex(t => t.path === path);
  if (idx === -1) return;
  openTabs.splice(idx, 1);
  if (activeTabPath === path) {
    const next = openTabs[idx] ?? openTabs[idx - 1];
    if (next) {
      openPage(next.path, next.name);
    } else {
      activeTabPath = null;
      activePath = null;
      renderBreadcrumb(null);
      activeView?.destroy(); activeView = null;
      activeVisual?.destroy(); activeVisual = null;
      activeDb?.destroy(); activeDb = null;
      editorMountEl.innerHTML = '';
      noPageMessageEl.classList.add('visible');
      pageTitleEl.textContent = '';
      btnSave.disabled = true; btnCommit.disabled = true;
    }
  }
  renderTabBar();
}

function markTabDirty(path: string, dirty: boolean) {
  const tab = openTabs.find(t => t.path === path);
  if (tab) { tab.dirty = dirty; renderTabBar(); }
}

// ─── #140 Secondary pane tab bar ──────────────────────────────────────────────
const openTabs2: TabEntry[] = [];
let activeTabPath2: string | null = null;

function renderTabBar2() {
  const bar = document.getElementById('tab-bar-2')!;
  if (!bar) return;
  bar.innerHTML = '';
  for (const tab of openTabs2) {
    const el = document.createElement('div');
    el.className = 'editor-tab' + (tab.path === activeTabPath2 ? ' active' : '');
    el.title = tab.path;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(tab.path === activeTabPath2));
    el.dataset.path = tab.path;

    const dot = document.createElement('span');
    dot.className = 'editor-tab-dot';
    dot.style.visibility = tab.dirty ? 'visible' : 'hidden';

    const name = document.createElement('span');
    name.className = 'editor-tab-name';
    name.textContent = tab.name;

    const close = document.createElement('button');
    close.className = 'editor-tab-close';
    close.title = 'Close tab';
    close.setAttribute('aria-label', `Close ${tab.name}`);
    close.textContent = '×';
    close.addEventListener('click', ev => {
      ev.stopPropagation();
      closeTab2(tab.path);
    });

    el.append(dot, name, close);
    el.addEventListener('click', () => {
      setFocusedPane('secondary');
      if (tab.path !== activePath2) void openPageInPane2(tab.path, tab.name);
    });
    bar.appendChild(el);
  }
}

function ensureTab2(path: string, name: string) {
  if (!openTabs2.find(t => t.path === path)) {
    openTabs2.push({ path, name, dirty: false });
  }
  activeTabPath2 = path;
  renderTabBar2();
}

function closeTab2(path: string) {
  const idx = openTabs2.findIndex(t => t.path === path);
  if (idx === -1) return;
  openTabs2.splice(idx, 1);
  if (activeTabPath2 === path) {
    const next = openTabs2[idx] ?? openTabs2[idx - 1];
    if (next) {
      void openPageInPane2(next.path, next.name);
    } else {
      activeTabPath2 = null;
      activePath2 = null;
      activeView2?.destroy(); activeView2 = null;
      editorMount2El.innerHTML = '';
    }
  }
  renderTabBar2();
}

function markTabDirty2(path: string, dirty: boolean) {
  const tab = openTabs2.find(t => t.path === path);
  if (tab) { tab.dirty = dirty; renderTabBar2(); }
}


requestAnimationFrame(() => {
  const tabBarEl = document.getElementById('tab-bar')!;
  if (!tabBarEl) return;
  // intercept sidebar file-tree clicks by observing activePath changes via MutationObserver on page title
  const titleObs = new MutationObserver(() => {
    if (activePath) ensureTab(activePath, pageTitleEl.textContent ?? activePath);
  });
  titleObs.observe(pageTitleEl, { childList: true, characterData: true, subtree: true });
});

// Mark tab dirty when isDirty changes — patch this into setDirtyState
function setDirtyTab(dirty: boolean) { if (activePath) markTabDirty(activePath, dirty); }

// ─── #113 Command palette (Ctrl+K) ───────────────────────────────────────────
{
  const palette   = document.getElementById('cmd-palette')!;
  const backdrop  = document.getElementById('cmd-palette-backdrop')!;
  const input     = document.getElementById('cmd-palette-input') as HTMLInputElement;
  const list      = document.getElementById('cmd-palette-list')!;
  let selectedIdx = 0;
  let currentItems: PaletteEntry[] = [];

  function buildActions() {
    return [
      { icon: '📄', label: 'New page',          hint: '',           action: () => btnNewPage.click() },
      { icon: '⊞',  label: 'New database',      hint: '',           action: () => btnNewDb.click() },
      { icon: '💾', label: 'Save',               hint: 'Ctrl+S',    action: () => { if (isDirty) saveCurrentPage(); } },
      { icon: '📦', label: 'Commit changes',     hint: 'Ctrl+⇧G',  action: () => btnCommit.click() },
      { icon: '⎇',  label: 'Switch branch',      hint: '',          action: () => (document.getElementById('btn-branch-picker') as HTMLButtonElement)?.click() },
      { icon: '👁',  label: 'Toggle preview',    hint: 'Ctrl+⇧P',  action: () => (document.getElementById('btn-preview') as HTMLButtonElement)?.click() },
      { icon: '⊡',  label: 'Toggle properties', hint: 'Ctrl+⇧B',  action: () => btnProperties.click() },
      { icon: '◈',  label: 'Open graph',         hint: '',          action: () => graphView?.open() },
      { icon: '⧉',  label: 'Toggle split editor', hint: 'Ctrl+\\',  action: () => toggleSplit() },
      { icon: '?',  label: 'Keyboard shortcuts', hint: '',          action: () => (document.getElementById('kbd-dialog') as HTMLDialogElement)?.showModal() },
    ];
  }

  function renderPalette(q: string) {
    const actions = filterEntries(buildActions(), q);
    currentItems = actions;
    selectedIdx = 0;
    list.innerHTML = '';
    if (!actions.length) {
      const empty = document.createElement('li');
      empty.className = 'cmd-item';
      empty.textContent = 'No results';
      list.appendChild(empty);
      return;
    }
    for (const [i, item] of actions.entries()) {
      const li = document.createElement('li');
      li.className = 'cmd-item' + (i === 0 ? ' selected' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === 0));
      li.innerHTML = `<span class="cmd-item-icon">${item.icon}</span>
        <span class="cmd-item-label">${item.label}</span>
        <span class="cmd-item-hint">${item.hint}</span>`;
      li.addEventListener('mouseenter', () => setSelected(i));
      li.addEventListener('click', () => { closeCmdPalette(); item.action(); });
      list.appendChild(li);
    }
  }

  function setSelected(idx: number) {
    const items = list.querySelectorAll<HTMLLIElement>('.cmd-item');
    items[selectedIdx]?.classList.remove('selected');
    items[selectedIdx]?.setAttribute('aria-selected', 'false');
    selectedIdx = Math.max(0, Math.min(items.length - 1, idx));
    items[selectedIdx]?.classList.add('selected');
    items[selectedIdx]?.setAttribute('aria-selected', 'true');
    items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
  }

  (window as unknown as Record<string, unknown>)['openCmdPalette'] = openCmdPalette;
  function openCmdPalette() {
    palette.classList.remove('hidden');
    input.value = '';
    renderPalette('');
    // Defer focus by one frame so the browser has processed the display change
    // before attempting to focus the input (needed for headless Chromium).
    requestAnimationFrame(() => input.focus());
  }

  (window as unknown as Record<string, unknown>)['closeCmdPalette'] = closeCmdPalette;
  function closeCmdPalette() {
    palette.classList.add('hidden');
    input.value = '';
  }

  input.addEventListener('input', () => renderPalette(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown')  { e.preventDefault(); setSelected(moveIdx(selectedIdx, 1, currentItems.length)); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); setSelected(moveIdx(selectedIdx, -1, currentItems.length)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const action = currentItems[selectedIdx];
      closeCmdPalette();
      action?.action();
    }
    if (e.key === 'Escape') { e.preventDefault(); closeCmdPalette(); }
  });

  backdrop.addEventListener('click', closeCmdPalette);
}

function openCmdPalette() { (window as unknown as Record<string, unknown>)['openCmdPalette']?.(); }
function closeCmdPalette() { (window as unknown as Record<string, unknown>)['closeCmdPalette']?.(); }

// ─── #115 Light/dark theme toggle ────────────────────────────────────────────
{
  const btnTheme = document.getElementById('btn-theme') as HTMLButtonElement | null;

  // Apply initial theme (stored pref → OS pref → dark)
  applyTheme(resolveInitialTheme(), document.documentElement, btnTheme);

  btnTheme?.addEventListener('click', () => {
    const next = toggleTheme(document.documentElement);
    storeTheme(next);
    applyTheme(next, document.documentElement, btnTheme);
  });

  // Respond to OS theme preference changes (only when user has no override)
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    const stored = localStorage.getItem('qs_theme');
    if (!stored) applyTheme(e.matches ? 'light' : 'dark', document.documentElement, btnTheme);
  });
}

// ─── #116 / #117 Status bar click actions ────────────────────────────────────
{
  const sbBranchBtn = document.getElementById('sb-branch') as HTMLButtonElement | null;
  sbBranchBtn?.addEventListener('click', () => {
    (document.getElementById('btn-branch-picker') as HTMLButtonElement)?.click();
  });

  const sbSaveBtn = document.getElementById('sb-save-status');
  sbSaveBtn?.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('.stab[data-tab="git"]')?.click();
  });
}

// ─── Keyboard shortcuts help button ──────────────────────────────────────────
document.getElementById('btn-kbd')?.addEventListener('click', () => {
  (document.getElementById('kbd-dialog') as HTMLDialogElement)?.showModal();
});

// ─── #140 Split editor wiring ─────────────────────────────────────────────────
btnSplit.addEventListener('click', toggleSplit);

// Pane focus: clicking inside a pane marks it as the active target for sidebar nav
{
  const primaryPane   = document.getElementById('editor-pane-primary')!;
  const secondaryPane = document.getElementById('editor-pane-secondary')!;
  primaryPane.addEventListener('mousedown', () => { if (splitActive) setFocusedPane('primary'); });
  secondaryPane.addEventListener('mousedown', () => { if (splitActive) setFocusedPane('secondary'); });
}

// Pane divider drag-to-resize between primary and secondary editor panes
{
  const paneDivider   = document.getElementById('editor-pane-divider')!;
  const primaryPane   = document.getElementById('editor-pane-primary') as HTMLElement;
  const secondaryPane = document.getElementById('editor-pane-secondary') as HTMLElement;

  paneDivider.addEventListener('mousedown', ev => {
    ev.preventDefault();
    paneDivider.classList.add('dragging');
    const startX = ev.clientX;
    const startW = primaryPane.offsetWidth;
    const total  = (primaryPane.parentElement as HTMLElement).offsetWidth;
    const onMove = (e: MouseEvent) => {
      const newW = Math.max(200, Math.min(total - 200, startW + e.clientX - startX));
      primaryPane.style.flex = 'none';
      primaryPane.style.width = `${newW}px`;
      secondaryPane.style.flex = '1';
      secondaryPane.style.width = '';
    };
    const onUp = () => {
      paneDivider.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}


// Patch into existing dirty-state changes by observing sbSaveStatus text
{
  const obs = new MutationObserver(() => {
    const dirty = sbSaveStatus.textContent?.includes('Unsaved') ?? false;
    setDirtyTab(dirty);
  });
  obs.observe(sbSaveStatus, { childList: true, characterData: true, subtree: true });
}

