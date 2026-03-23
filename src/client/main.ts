// src/client/main.ts
// Application entry point for the quartostone single-page editor.
//
// Responsibilities:
//   • Boot: fetch /api/config, /api/session, resolve theme.
//   • DOM wiring: sidebar, source editor (CodeMirror), visual editor (PanMirror),
//     database view, properties panel, command palette, split-pane.
//   • State management: active page path, editor mode, dirty flag, auto-commit timer.
//   • Git integration: status poll, branch picker, commit dialog, push/pull.
//   • Live-reload: server-sent events forwarded to sidebar/editor/git panel.

import { createEditor, connectLiveReload } from './editor/index.js';
import { createVisualEditor } from './visual/index.js';
import type { VisualEditorInstance } from './visual/index.js';
import { initDatabaseView } from './database/index.js';
import type { DbInstance } from './database/index.js';
import { initSidebar, addRecentPage } from './sidebar/index.js';
import { initGitPanel } from './git/index.js';

import { initBranchPicker } from './branches/index.js';
import type { BranchPickerResult } from './branches/index.js';
import { initHistoryPanel } from './history/index.js';
import { initExportPicker } from './export/index.js';

import { initBacklinksPanel } from './backlinks/index.js';
import type { BacklinksPanel } from './backlinks/index.js';
import { initSearchOverlay } from './search/index.js';
import { initGraphPanel } from './graph/index.js';
import type { EditorView } from '@codemirror/view';
import { applyTheme, toggleTheme, storeTheme, resolveInitialTheme } from './theme.js';
import { filterEntries, moveIdx } from './cmdpalette/filter.js';
import type { PaletteEntry } from './cmdpalette/filter.js';

import { showToast } from './utils/toast.js';
import type { ToastKind } from './utils/toast.js';
import { TabBarManager } from './tabbar/index.js';
import { API } from './api/endpoints.js';
import { initToken, apiFetch } from './api/request.js';
import { STORAGE_KEYS } from './storage.js';
import { activePath, isDirty, editorMode, setActivePath, setIsDirty, setEditorMode } from './state/editorState.js';
import { updateBranchStatus, initStatusBar } from './ui/statusBar.js';
import { openCommitDialog, initCommitDialog, showCommitPrompt, makeAutoSlug } from './ui/commitDialog.js';
import { registerKeyboardShortcuts } from './keyboard.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const SAVE_STATUS_CLEAR_DELAY_MS = 2_000;   // duration the save status badge stays visible

// ─── DOM helpers ─────────────────────────────────────────────────────────────
// Q03: throws a clear error instead of a cryptic TypeError when a required element is missing.
function ensureEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[quartostone] Required DOM element #${id} not found`);
  return el as T;
}

// ─── DOM references ───────────────────────────────────────────────────────────
const fileTreeEl = ensureEl('file-tree');
const editorMountEl = ensureEl('editor-mount');
const noPageMessageEl = ensureEl('no-page-message');

const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
const btnNewPage = document.getElementById('btn-new-page') as HTMLButtonElement;
const btnNewDb = document.getElementById('btn-new-db') as HTMLButtonElement;
const btnEditMode = document.getElementById('btn-edit-mode') as HTMLButtonElement;
const editModeDropdown = document.getElementById('edit-mode-dropdown') as HTMLDivElement;
const btnEditSource = document.getElementById('btn-edit-source') as HTMLButtonElement;
const btnEditVisual = document.getElementById('btn-edit-visual') as HTMLButtonElement;

const gitPanelEl = document.getElementById('git-panel')!;
const historyPanelEl = document.getElementById('history-panel')!;
const sbRenderStatus = document.getElementById('sb-render-status')!;
const sbSaveStatus = document.getElementById('sb-save-status')!;
const editorMount2El = document.getElementById('editor-mount-2')!;
const editorSplitEl = document.getElementById('editor-split')!;
const btnSplit = document.getElementById('btn-split') as HTMLButtonElement;

// L-2: named-input dialogs (replace window.prompt)
const newPageDialog = document.getElementById('new-page-dialog') as HTMLDialogElement;
const newPageNameInput = document.getElementById('new-page-name') as HTMLInputElement;
const btnNewPageConfirm = document.getElementById('btn-new-page-confirm') as HTMLButtonElement;
const btnNewPageCancel = document.getElementById('btn-new-page-cancel') as HTMLButtonElement;
const newFolderDialog = document.getElementById('new-folder-dialog') as HTMLDialogElement;
const newFolderNameInput = document.getElementById('new-folder-name') as HTMLInputElement;
const btnNewFolderConfirm = document.getElementById('btn-new-folder-confirm') as HTMLButtonElement;
const btnNewFolderCancel = document.getElementById('btn-new-folder-cancel') as HTMLButtonElement;
const btnNewFolder = document.getElementById('btn-new-folder') as HTMLButtonElement;
const newDbDialog = document.getElementById('new-db-dialog') as HTMLDialogElement;
const newDbNameInput = document.getElementById('new-db-name') as HTMLInputElement;
const btnNewDbConfirm = document.getElementById('btn-new-db-confirm') as HTMLButtonElement;
const btnNewDbCancel = document.getElementById('btn-new-db-cancel') as HTMLButtonElement;

// ─── State ────────────────────────────────────────────────────────────────────
let activeView: EditorView | null = null;
let activeVisual: VisualEditorInstance | null = null;
let activeDb: DbInstance | null = null;
let refreshSidebar: (() => Promise<void>) | null = null;
let refreshGit: (() => Promise<void>) | null = null;
let branchPicker: BranchPickerResult | null = null;
let historySetPage: ((path: string | null) => void) | null = null;

let backlinksPanel: BacklinksPanel | null = null;
let graphView: { open(): void; close(): void; refresh(): void } | null = null;
let switchingMode = false;    // M-4: guard against concurrent mode switches
let openPageInProgress = false; // B9: guard against concurrent openPage calls
let visualMarkdownCache = ''; // last-known markdown when visual editor is active
const serverPagesDir = 'pages'; // overridden at boot time via GET /api/config (Q29)

// module-level palette controls (FIX MAIN-05)
let openCmdPalette: () => void = () => { };
let closeCmdPalette: () => void = () => { };
// module-level export picker handle (FIX EXP-02)
let exportPicker: { setPageReady(ready: boolean): void } | null = null;

// ─── Split pane state (#140) ──────────────────────────────────────────────────
let splitActive = false;
let focusedPane: 'primary' | 'secondary' = 'primary';
let activeView2: EditorView | null = null;
let activePath2: string | null = null;



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
        onOpenPage: (path) => openPage(path, path.split('/').pop()?.replace(/\.qmd$/i, '') ?? path),
        onDirty: () => {
          setIsDirty(true);
          if (activePath) primaryTabs.markDirty(activePath, true);
          sbSaveStatus.textContent = 'Unsaved changes';
          // update cache asynchronously so properties panel stays mostly fresh
          activeVisual?.getMarkdown().then(md => { visualMarkdownCache = md; }).catch(err => console.warn('[VisualEditor] getMarkdown failed:', err));
        },
      });

      const visualToolbar = ensureEl('visual-toolbar');
      visualToolbar.innerHTML = '';
      visualToolbar.classList.add('hidden'); // Hide manual toolbar as new editor has its own

      setEditorMode('visual');
    } else {
      // Get current visual content, destroy visual editor, init source
      const visualToolbar = document.getElementById('visual-toolbar');
      if (visualToolbar) visualToolbar.classList.add('hidden');

      const markdown = activeVisual ? await activeVisual.getMarkdown() : visualMarkdownCache;
      visualMarkdownCache = '';
      activeVisual?.destroy();
      activeVisual = null;
      editorMountEl.innerHTML = '';

      activeView = await createEditor({
        container: editorMountEl,
        pagePath: activePath,
        onSave: () => {
          setIsDirty(false);
          if (activePath) primaryTabs.markDirty(activePath, false);
          sbSaveStatus.textContent = 'Saved';
          setTimeout(() => { sbSaveStatus.textContent = ''; }, SAVE_STATUS_CLEAR_DELAY_MS);
          refreshGit?.();
          updateBranchStatus();
        },
        onSaveError: (err) => {
          showToast(`Auto-save failed: ${err.message}`, 'error');
          sbSaveStatus.textContent = '';
        },
        onDirty: () => {
          setIsDirty(true);
          if (activePath) primaryTabs.markDirty(activePath, true);
          sbSaveStatus.textContent = 'Unsaved changes';
        },
      });

      // Inject markdown from visual editor into source editor
      if (markdown && activeView) {
        const { state } = activeView;
        activeView.dispatch(state.update({
          changes: { from: 0, to: state.doc.length, insert: markdown },
        }));
      }

      setEditorMode('source');
    }
  } finally {
    switchingMode = false;
  }
}

// ─── Edit Mode Dropdown handling ──────────────────────────────────────────────
btnEditMode.addEventListener('click', (e) => {
  e.stopPropagation();
  const isHidden = editModeDropdown.classList.contains('hidden');
  editModeDropdown.classList.toggle('hidden', !isHidden);
  btnEditMode.setAttribute('aria-expanded', String(isHidden));
});
document.addEventListener('click', (e) => {
  if (!editModeDropdown.contains(e.target as Node) && !btnEditMode.contains(e.target as Node)) {
    editModeDropdown.classList.add('hidden');
    btnEditMode.setAttribute('aria-expanded', 'false');
  }
});
btnEditSource.addEventListener('click', () => {
  editModeDropdown.classList.add('hidden');
  switchMode('source');
});
btnEditVisual.addEventListener('click', () => {
  editModeDropdown.classList.add('hidden');
  switchMode('visual');
});

// ─── Sidebar tabs ─────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.stab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.stab-panel').forEach(p => p.classList.add('hidden'));
    tab.classList.add('active');
    const panelId = `tab-${tab.dataset['tab']}`;
    document.getElementById(panelId)?.classList.remove('hidden');
  });
});

// ─── Toolbar ──────────────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  if (!activePath) return;
  if (isDirty) {
    await saveCurrentPage();
  }
  openCommitDialog(makeAutoSlug());
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
    const res = await apiFetch(API.pages, {
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
    const res = await apiFetch(API.directories, {
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
    const res = await apiFetch(`${API.dbCreate}?path=${encodeURIComponent(path)}`, {
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
    const res = await apiFetch(`${API.pages}/${encodeURIComponent(activePath)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      sbSaveStatus.textContent = '';
      showToast('Save failed', 'error');
      return;
    }
    setIsDirty(false);
    sbSaveStatus.textContent = 'Saved';
    setTimeout(() => { sbSaveStatus.textContent = ''; }, SAVE_STATUS_CLEAR_DELAY_MS);
  } catch {
    showToast('Save failed', 'error');
    sbSaveStatus.textContent = '';
  }
}



// ─── Editor load ────────────────────────────────────────────────────────────── 
async function openPage(path: string, name: string) {  // M-1: guard against silently discarding unsaved changes
  if (openPageInProgress) return; // B9: drop concurrent calls
  openPageInProgress = true;
  try {
    if (isDirty) {
      const discard = confirm('You have unsaved changes. Discard them?');
      if (!discard) return;
    }
    // Destroy any active editor
    activeView?.destroy(); activeView = null;
    activeVisual?.destroy(); activeVisual = null;
    activeDb?.destroy(); activeDb = null;
    editorMountEl.innerHTML = '';

    primaryTabs.ensure(path, name);
    setActivePath(path);
    setIsDirty(false);
    noPageMessageEl.classList.remove('visible');
    exportPicker?.setPageReady(true)

    // Check if this is a database page
    const dbInstance = await initDatabaseView(editorMountEl, path);
    if (dbInstance) {
      activeDb = dbInstance;
      // Hide mode toggle buttons — database has its own view switcher
      btnEditMode.style.display = 'none';
      editModeDropdown.classList.add('hidden');
      return;
    }

    // Show mode toggle buttons for regular pages
    btnEditMode.style.display = '';

    if (editorMode === 'visual') {
      // Fetch content then open in visual mode — C-2: add error handling
      try {
        const res = await apiFetch(`/api/pages/${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data = await res.json() as { content?: string };
        activeVisual = await createVisualEditor({
          container: editorMountEl,
          initialMarkdown: data.content ?? '',
          documentPath: path,
          onOpenPage: (p) => openPage(p, p.split('/').pop()?.replace(/\.qmd$/i, '') ?? p),
          onDirty: () => {
            setIsDirty(true);
            primaryTabs.markDirty(path, true);
            sbSaveStatus.textContent = 'Unsaved changes';
          },
        });
      } catch (e) {
        showToast(`Failed to load page: ${String(e)}`, 'error');
        noPageMessageEl.classList.add('visible');
        setActivePath(null);
      }
    } else {
      activeView = await createEditor({
        container: editorMountEl,
        pagePath: path,
        onSave: () => {
          setIsDirty(false);
          primaryTabs.markDirty(path, false);
          sbSaveStatus.textContent = 'Saved';
          setTimeout(() => { sbSaveStatus.textContent = ''; }, SAVE_STATUS_CLEAR_DELAY_MS);
          refreshGit?.();
          updateBranchStatus();
        },
        onSaveError: (err) => {
          showToast(`Auto-save failed: ${err.message}`, 'error');
          sbSaveStatus.textContent = '';
        },
        onDirty: () => {
          setIsDirty(true);
          primaryTabs.markDirty(path, true);
          sbSaveStatus.textContent = 'Unsaved changes';
        },
      });
    }

    // Update history panel with newly opened page
    historySetPage?.(path);



    // Update backlinks panel with newly opened page
    backlinksPanel?.setPage(path);


  } finally {
    openPageInProgress = false;
  }
}

// ─── #140 Split editor helpers ────────────────────────────────────────────────

/** Set which pane is "focused" — sidebar nav routes into it. */
function setFocusedPane(pane: 'primary' | 'secondary') {
  focusedPane = pane;
  const primaryEl = document.getElementById('editor-pane-primary');
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
        secondaryTabs.markDirty(path, false);
      },
      onSaveError: (err) => {
        showToast(`Pane 2 auto-save failed: ${err.message}`, 'error');
      },
      onDirty: () => {
        secondaryTabs.markDirty(path, true);
      },
    });
  } catch (e) {
    showToast(`Failed to load in split pane: ${String(e)}`, 'error');
    activePath2 = null;
    return;
  }
  secondaryTabs.ensure(path, name);
}

/** Destroy the secondary pane editor and clear its state. */
function closeSplitPane(): void {
  activeView2?.destroy();
  activeView2 = null;
  activePath2 = null;
  secondaryTabs.clear();
  editorMount2El.innerHTML = '';
  secondaryTabs.render();
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
      void openPageInPane2(activePath, activePath);
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
    showCommitPrompt(d.autoSlug ?? makeAutoSlug());
  }
  if (event === 'git:committed') {
    refreshGit?.();
    branchPicker?.refresh();
    updateBranchStatus();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
// S01: Fetch the session token before any authenticated API call.
await initToken();

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
      setActivePath(null);
      activeView?.destroy(); activeView = null;
      activeVisual?.destroy(); activeVisual = null;
      activeDb?.destroy(); activeDb = null;
      editorMountEl.innerHTML = '';
      noPageMessageEl.classList.add('visible');
    }
  },
  getActivePath: () => activePath,
}).then(refresh => { refreshSidebar = refresh; }).catch(err => showToast(`Sidebar init failed: ${String(err)}`, 'error'));

initGitPanel(gitPanelEl, openCommitDialog).then(({ refresh }) => { refreshGit = refresh; }).catch(err => showToast(`Git panel init failed: ${String(err)}`, 'error'));

branchPicker = initBranchPicker((branch, stashConflict) => {
  updateBranchStatus();
  showToast(`Switched to branch "${branch}"`, 'success');
  if (stashConflict) showToast('Stash re-apply had conflicts — check your files', 'error', 6000);
  // Reload current page on branch switch so content reflects new branch
  if (activePath) void openPage(activePath, activePath);
}, showToast);

// ── Export picker ───────────────────────────────────────────────────────────
exportPicker = initExportPicker(() => activePath);



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
  if (activePath) void openPage(activePath, activePath).catch((e: unknown) => showToast(String(e), 'error'));
  showToast('File restored to selected commit', 'success');
}).then(hp => { historySetPage = hp.setPage; }).catch(err => showToast(`History panel init failed: ${String(err)}`, 'error'));

initCommitDialog(async () => {
  await refreshGit?.();
  await branchPicker?.refresh();
  updateBranchStatus();
  if (activePath) {
    const panel = historyPanelEl as HTMLElement & { refreshHistory?: () => void };
    panel.refreshHistory?.();
  }
});

initStatusBar();

registerKeyboardShortcuts({
  hasActiveDb: () => activeDb !== null,
  saveCurrentPage,
  openCommitDialog,
  makeAutoSlug,
  switchMode,
  searchOpen: () => searchOverlay.open(),
  openCmdPalette: () => openCmdPalette(),
  closeCmdPalette: () => closeCmdPalette(),
  toggleSplit,

});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-8: UX Polish and Accessibility
// ═══════════════════════════════════════════════════════════════════════════

// ─── #111 Resizable sidebar ───────────────────────────────────────────────────
{
  const sidebarEl = document.getElementById('sidebar') as HTMLElement;
  const resizer = document.getElementById('sidebar-resizer') as HTMLElement;
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

// ─── #112 + #140 Tab bar managers ────────────────────────────────────────────
const primaryTabs = new TabBarManager(
  'tab-bar',
  (path, name) => openPage(path, name),
  () => {
    setActivePath(null);
    activeView?.destroy(); activeView = null;
    activeVisual?.destroy(); activeVisual = null;
    activeDb?.destroy(); activeDb = null;
    editorMountEl.innerHTML = '';
    noPageMessageEl.classList.add('visible');
  },
  (path, name, sourceBarId) => {
    // If dropped from secondary pane, close it there and open it here
    if (sourceBarId === 'tab-bar-2') {
      secondaryTabs.close(path);
    }
    openPage(path, name);
  }
);

const secondaryTabs = new TabBarManager(
  'tab-bar-2',
  (path, name) => { setFocusedPane('secondary'); void openPageInPane2(path, name); },
  () => {
    activePath2 = null;
    activeView2?.destroy(); activeView2 = null;
    editorMount2El.innerHTML = '';
  },
  (path, name, sourceBarId) => {
    // If dropped from primary pane, close it there and open it here
    if (sourceBarId === 'tab-bar') {
      primaryTabs.close(path);
    }
    setFocusedPane('secondary');
    void openPageInPane2(path, name);
  }
);



// ─── #113 Command palette (Ctrl+K) ───────────────────────────────────────────
{
  const palette = document.getElementById('cmd-palette')!;
  const backdrop = document.getElementById('cmd-palette-backdrop')!;
  const input = document.getElementById('cmd-palette-input') as HTMLInputElement;
  const list = document.getElementById('cmd-palette-list')!;
  let selectedIdx = 0;
  let currentItems: PaletteEntry[] = [];

  function buildActions() {
    return [
      { icon: '📄', label: 'New page', hint: '', action: () => btnNewPage.click() },
      { icon: '⊞', label: 'New database', hint: '', action: () => btnNewDb.click() },
      { icon: '💾', label: 'Save and commit', hint: 'Ctrl+S', action: () => btnSave.click() },
      { icon: '⎇', label: 'Switch branch', hint: '', action: () => (document.getElementById('btn-branch-picker') as HTMLButtonElement)?.click() },

      { icon: '◈', label: 'Open graph', hint: '', action: () => graphView?.open() },
      { icon: '⧉', label: 'Toggle split editor', hint: 'Ctrl+\\', action: () => toggleSplit() },
      { icon: '?', label: 'Keyboard shortcuts', hint: '', action: () => (document.getElementById('kbd-dialog') as HTMLDialogElement)?.showModal() },
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
    selectedIdx = idx;
    items[selectedIdx]?.classList.add('selected');
    items[selectedIdx]?.setAttribute('aria-selected', 'true');
  }

  openCmdPalette = () => {
    palette.classList.remove('hidden');
    input.value = '';
    renderPalette('');
    // Defer focus by one frame so the browser has processed the display change
    // before attempting to focus the input (needed for headless Chromium).
    requestAnimationFrame(() => input.focus());
  };

  closeCmdPalette = () => {
    palette.classList.add('hidden');
    input.value = '';
  };

  input.addEventListener('input', () => renderPalette(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(moveIdx(selectedIdx, 1, currentItems.length)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(moveIdx(selectedIdx, -1, currentItems.length)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const action = currentItems[selectedIdx];
      closeCmdPalette();
      action?.action();
    }
  });
  backdrop.addEventListener('click', closeCmdPalette);
}

// ─── #115 Light/dark theme toggle ────────────────────────────────────────────
{
  const btnTheme = document.getElementById('btn-theme') as HTMLButtonElement | null;

  // Apply initial theme (stored pref → OS pref → dark)
  applyTheme(resolveInitialTheme(), document.documentElement, btnTheme);

  btnTheme?.addEventListener('click', () => {
    const next = toggleTheme(document.documentElement);
    storeTheme(next);
    applyTheme(next, document.documentElement, btnTheme);
    activeVisual?.updateTheme();
  });

  // Respond to OS theme preference changes (only when user has no override)
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    const stored = localStorage.getItem('qs_theme');
    if (!stored) {
      applyTheme(e.matches ? 'light' : 'dark', document.documentElement, btnTheme);
      activeVisual?.updateTheme();
    }
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
  const primaryPane = document.getElementById('editor-pane-primary')!;
  const secondaryPane = document.getElementById('editor-pane-secondary')!;
  primaryPane.addEventListener('mousedown', () => { if (splitActive) setFocusedPane('primary'); });
  secondaryPane.addEventListener('mousedown', () => { if (splitActive) setFocusedPane('secondary'); });
}

// Pane divider drag-to-resize between primary and secondary editor panes
{
  const paneDivider = document.getElementById('editor-pane-divider')!;
  const primaryPane = document.getElementById('editor-pane-primary') as HTMLElement;
  const secondaryPane = document.getElementById('editor-pane-secondary') as HTMLElement;

  paneDivider.addEventListener('mousedown', ev => {
    ev.preventDefault();
    paneDivider.classList.add('dragging');
    const startX = ev.clientX;
    const startW = primaryPane.offsetWidth;
    const total = (primaryPane.parentElement as HTMLElement).offsetWidth;
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
