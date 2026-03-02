// src/client/main.ts
// Application entry point — wires sidebar, editor, git panel, properties panel.

import { createEditor, connectLiveReload } from './editor/index.js';
import { createVisualEditor } from './visual/index.js';
import type { VisualEditorInstance } from './visual/index.js';
import { initDatabaseView } from './database/index.js';
import type { DbInstance } from './database/index.js';
import { initSidebar } from './sidebar/index.js';
import { initGitPanel } from './git/index.js';
import { createPropertiesPanel } from './properties/index.js';
import { initBranchPicker } from './branches/index.js';
import type { BranchPickerResult } from './branches/index.js';
import { initHistoryPanel } from './history/index.js';
import { initExportPicker } from './export/index.js';
import { initPreviewPanel } from './preview/index.js';
import type { PreviewPanel } from './preview/index.js';
import type { EditorView } from '@codemirror/view';

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
const sbRenderStatus   = document.getElementById('sb-render-status')!;
const sbSaveStatus     = document.getElementById('sb-save-status')!;

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
  confirmBtn.addEventListener('click', () => { toast.remove(); openCommitDialog(autoSlug); });
  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => toast.remove());
  actions.append(confirmBtn, dismissBtn);
  toast.appendChild(actions);
  toastContainer.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 30000);
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

  if (mode === 'visual') {
    // Get current source content, destroy source editor, init visual
    const markdown = activeView ? activeView.state.doc.toString() : '';
    activeView?.destroy();
    activeView = null;
    editorMountEl.innerHTML = '';

    activeVisual = await createVisualEditor({
      container: editorMountEl,
      initialMarkdown: markdown,
      onDirty: () => {
        isDirty = true;
        btnSave.disabled = false;
        sbSaveStatus.textContent = 'Unsaved changes';
      },
    });

    editorMode = 'visual';
    btnModeSource.classList.remove('active');
    btnModeVisual.classList.add('active');
  } else {
    // Get current visual content, destroy visual editor, init source
    const markdown = activeVisual ? activeVisual.getMarkdown() : '';
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
        ? activeVisual.getMarkdown()
        : (activeView ? activeView.state.doc.toString() : '');
    const setContent = (newContent: string) => {
      if (editorMode === 'source' && activeView) {
        const { dispatch, state } = activeView;
        dispatch(state.update({
          changes: { from: 0, to: state.doc.length, insert: newContent },
        }));
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

btnNewPage.addEventListener('click', async () => {
  const name = window.prompt('Page name (e.g. "my-notes"):');
  if (!name) return;
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

btnNewDb.addEventListener('click', async () => {
  const name = window.prompt('Database name (e.g. "tasks"):');
  if (!name) return;
  const path = `pages/${name.replace(/\s+/g, '-').toLowerCase()}.qmd`;
  try {
    const res = await fetch(`/api/db/create?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: name }),
    });
    if (!res.ok) throw new Error((await res.json() as { error: string }).error);
    await refreshSidebar?.();
    showToast(`Created database ${name}`, 'success');
    openPage(path, name);
  } catch (e) {
    showToast(`Failed: ${String(e)}`, 'error');
  }
});

// ─── Save ─────────────────────────────────────────────────────────────────────
async function saveCurrentPage() {
  if (!activePath) return;
  if (activeDb) return; // Database auto-saves on cell change
  const content = editorMode === 'visual' && activeVisual
    ? activeVisual.getMarkdown()
    : (activeView ? activeView.state.doc.toString() : '');
  if (!content) return;
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
    const s = await res.json() as { current: string; files: unknown[] };
    const dirty = s.files.length > 0;
    sbBranch.textContent = `⎇ ${s.current}${dirty ? ` · ${s.files.length} changed` : ''}`;
    sbBranch.className = dirty ? 'sb-dirty' : '';
  } catch {
    sbBranch.textContent = '';
  }
}

// ─── Editor load ──────────────────────────────────────────────────────────────
async function openPage(path: string, name: string) {
  // Destroy any active editor
  activeView?.destroy(); activeView = null;
  activeVisual?.destroy(); activeVisual = null;
  activeDb?.destroy(); activeDb = null;
  editorMountEl.innerHTML = '';

  activePath = path;
  isDirty = false;
  pageTitleEl.textContent = name;
  noPageMessageEl.classList.remove('visible');
  btnSave.disabled = true;
  btnCommit.disabled = false;

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
    // Fetch content then open in visual mode
    const res = await fetch(`/api/pages/${encodeURIComponent(path)}`);
    const { content } = (await res.json()) as { content: string };
    activeVisual = await createVisualEditor({
      container: editorMountEl,
      initialMarkdown: content,
      onDirty: () => {
        isDirty = true;
        btnSave.disabled = false;
        sbSaveStatus.textContent = 'Unsaved changes';
      },
    });
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
      }
    };
    propsPanel.mount(path, getContent, setContent);
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
initSidebar(fileTreeEl, openPage).then(refresh => { refreshSidebar = refresh; });

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

const historyPanel = initHistoryPanel(historyPanelEl, () => {
  // After a restore, reload the current page
  if (activePath) openPage(activePath, pageTitleEl.textContent ?? activePath);
  showToast('File restored to selected commit', 'success');
});
historySetPage = historyPanel.setPage;

updateBranchStatus();

// Refresh git status every 30s
setInterval(updateBranchStatus, 30_000);

// Global Ctrl+S
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (isDirty) saveCurrentPage();
  }
});

