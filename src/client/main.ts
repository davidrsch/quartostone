// src/client/main.ts
// Application entry point — wires sidebar, editor, toolbar, and WebSocket.

import { createEditor, connectLiveReload } from './editor/index.js';
import { initSidebar } from './sidebar/index.js';
import type { EditorView } from '@codemirror/view';

// ─── DOM references ───────────────────────────────────────────────────────────
const fileTreeEl       = document.getElementById('file-tree')!;
const editorMountEl    = document.getElementById('editor-mount')!;
const noPageMessageEl  = document.getElementById('no-page-message')!;
const pageTitleEl      = document.getElementById('current-page-title')!;
const btnSave          = document.getElementById('btn-save') as HTMLButtonElement;
const btnCommit        = document.getElementById('btn-commit') as HTMLButtonElement;
const btnNewPage       = document.getElementById('btn-new-page') as HTMLButtonElement;
const toastContainer   = document.getElementById('toast-container')!;
const commitDialog     = document.getElementById('commit-dialog') as HTMLDialogElement;
const commitMsgInput   = document.getElementById('commit-msg') as HTMLInputElement;
const btnCommitConfirm = document.getElementById('btn-commit-confirm') as HTMLButtonElement;
const btnCommitCancel  = document.getElementById('btn-commit-cancel') as HTMLButtonElement;

// ─── State ────────────────────────────────────────────────────────────────────
let activeView: EditorView | null = null;
let activePath: string | null = null;
let isDirty = false;
let refreshSidebar: (() => Promise<void>) | null = null;

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
  confirmBtn.addEventListener('click', () => {
    toast.remove();
    openCommitDialog(autoSlug);
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => toast.remove());

  actions.append(confirmBtn, dismissBtn);
  toast.appendChild(actions);
  toastContainer.appendChild(toast);
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
  } catch (e) {
    showToast(`Commit failed: ${String(e)}`, 'error');
  }
});

btnCommitCancel.addEventListener('click', () => commitDialog.close());

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
  try {
    await fetch(`/api/pages/${encodeURIComponent(activePath)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    isDirty = false;
    btnSave.disabled = true;
    showToast('Saved', 'success', 1500);
  } catch {
    showToast('Save failed', 'error');
  }
}

// ─── Editor load ──────────────────────────────────────────────────────────────
async function openPage(path: string, name: string) {
  // Tear down existing editor
  if (activeView) {
    activeView.destroy();
    activeView = null;
  }
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
    },
    onDirty: () => {
      isDirty = true;
      btnSave.disabled = false;
    },
  });
}

// ─── Live reload (WebSocket) ──────────────────────────────────────────────────
connectLiveReload((event, data) => {
  if (event === 'render:complete') {
    showToast('Re-rendered', 'info', 1500);
  }
  if (event === 'git:prompt') {
    const d = data as { autoSlug?: string };
    showCommitPrompt(d.autoSlug ?? 'qs-xxxxxxxx');
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
noPageMessageEl.classList.add('visible');

initSidebar(fileTreeEl, openPage).then((refresh) => {
  refreshSidebar = refresh;
});

// Global Ctrl+S
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (isDirty) saveCurrentPage();
  }
});
