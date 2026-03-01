// src/client/main.ts
// Application entry point — wires sidebar, editor, git panel, properties panel.

import { createEditor, connectLiveReload } from './editor/index.js';
import { initSidebar } from './sidebar/index.js';
import { initGitPanel } from './git/index.js';
import { createPropertiesPanel } from './properties/index.js';
import type { EditorView } from '@codemirror/view';

// ─── DOM references ───────────────────────────────────────────────────────────
const fileTreeEl       = document.getElementById('file-tree')!;
const editorMountEl    = document.getElementById('editor-mount')!;
const noPageMessageEl  = document.getElementById('no-page-message')!;
const pageTitleEl      = document.getElementById('current-page-title')!;
const btnSave          = document.getElementById('btn-save') as HTMLButtonElement;
const btnCommit        = document.getElementById('btn-commit') as HTMLButtonElement;
const btnNewPage       = document.getElementById('btn-new-page') as HTMLButtonElement;
const btnProperties    = document.getElementById('btn-properties') as HTMLButtonElement;
const btnCloseProps    = document.getElementById('btn-close-props') as HTMLButtonElement;
const propertiesPanel  = document.getElementById('properties-panel')!;
const propertiesBody   = document.getElementById('properties-body')!;
const gitPanelEl       = document.getElementById('git-panel')!;
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
let activePath: string | null = null;
let isDirty = false;
let refreshSidebar: (() => Promise<void>) | null = null;
let refreshGit: (() => Promise<void>) | null = null;

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
    updateBranchStatus();
  } catch (e) {
    showToast(`Commit failed: ${String(e)}`, 'error');
  }
});

btnCommitCancel.addEventListener('click', () => commitDialog.close());

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
  if (!hidden && activePath && activeView) {
    propsPanel.mount(
      activePath,
      () => activeView!.state.doc.toString(),
      (newContent) => {
        // Replace editor content with updated frontmatter
        const { dispatch, state } = activeView!;
        dispatch(state.update({
          changes: { from: 0, to: state.doc.length, insert: newContent },
        }));
      },
    );
  }
});

btnCloseProps.addEventListener('click', () => {
  propertiesPanel.classList.add('hidden');
  btnProperties.classList.remove('active');
  propsPanel.unmount();
});

// ─── Toolbar ──────────────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  if (!activeView || !activePath) return;
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

// ─── Save ─────────────────────────────────────────────────────────────────────
async function saveCurrentPage() {
  if (!activeView || !activePath) return;
  const content = activeView.state.doc.toString();
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
  if (activeView) { activeView.destroy(); activeView = null; }
  editorMountEl.innerHTML = '';

  activePath = path;
  pageTitleEl.textContent = name;
  noPageMessageEl.classList.remove('visible');
  btnSave.disabled = false;
  btnCommit.disabled = false;

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

  // Re-mount properties panel if open
  if (!propertiesPanel.classList.contains('hidden')) {
    propsPanel.mount(
      path,
      () => activeView!.state.doc.toString(),
      (newContent) => {
        const { dispatch, state } = activeView!;
        dispatch(state.update({ changes: { from: 0, to: state.doc.length, insert: newContent } }));
      },
    );
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
    updateBranchStatus();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
initSidebar(fileTreeEl, openPage).then(refresh => { refreshSidebar = refresh; });

initGitPanel(gitPanelEl, openCommitDialog).then(({ refresh }) => { refreshGit = refresh; });

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

