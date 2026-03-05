// src/client/ui/commitDialog.ts
// Commit dialog: open/close, manual commit, and auto-commit prompt toast.

import { apiFetch } from '../api/request.js';
import { API } from '../api/endpoints.js';
import { showToast } from '../utils/toast.js';

/** Idle time before the auto-commit toast fires its fallback commit. */
const AUTO_COMMIT_DELAY_MS = 30_000;

/** Prefix for auto-generated commit slugs (Q26/Q32). */
const QS_SLUG_PREFIX = 'qs-';

/** Generate a random auto-commit slug with the canonical prefix. */
export function makeAutoSlug(): string {
  return `${QS_SLUG_PREFIX}${Math.random().toString(36).slice(2, 10)}`;
}

/** Callback invoked by main.ts after every successful commit. */
export type OnAfterCommit = (message: string) => Promise<void>;

let _onAfterCommit: OnAfterCommit = async () => {};

/** Open the commit dialog, pre-filling the message input. */
export function openCommitDialog(defaultMsg = ''): void {
  const commitDialog   = document.getElementById('commit-dialog')  as HTMLDialogElement;
  const commitMsgInput = document.getElementById('commit-msg')     as HTMLInputElement;
  commitMsgInput.value = defaultMsg;
  commitDialog.showModal();
  commitMsgInput.select();
}

/**
 * Wire the commit dialog confirm/cancel buttons.
 * Must be called once during boot before any commit can occur.
 */
export function initCommitDialog(onAfterCommit: OnAfterCommit): void {
  _onAfterCommit = onAfterCommit;

  const commitDialog    = document.getElementById('commit-dialog')      as HTMLDialogElement;
  const commitMsgInput  = document.getElementById('commit-msg')         as HTMLInputElement;
  const btnConfirm      = document.getElementById('btn-commit-confirm') as HTMLButtonElement;
  const btnCancel       = document.getElementById('btn-commit-cancel')  as HTMLButtonElement;

  btnConfirm.addEventListener('click', async () => {
    const message = commitMsgInput.value.trim();
    if (!message) return;
    commitDialog.close();
    try {
      const res = await apiFetch(API.gitCommit, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error((await res.json() as { error: string }).error);
      showToast(`Committed: ${message}`, 'success');
      await _onAfterCommit(message);
    } catch (e) {
      showToast(`Commit failed: ${String(e)}`, 'error');
    }
  });

  btnCancel.addEventListener('click', () => commitDialog.close());
}

/**
 * Show a "Rendered — commit changes?" toast with a timed auto-commit fallback.
 * Uses the `onAfterCommit` callback registered via `initCommitDialog`.
 */
export function showCommitPrompt(autoSlug: string): void {
  const toastContainer = document.getElementById('toast-container')!;
  const toast = document.createElement('div');
  toast.className = 'toast info';
  toast.innerHTML = `<span>Rendered — commit changes?</span>`;
  const actions = document.createElement('div');
  actions.className = 'toast-actions';
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Commit';
  confirmBtn.addEventListener('click', () => {
    toast.remove();
    clearTimeout(autoCommitTimer);
    openCommitDialog(autoSlug);
  });
  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => {
    toast.remove();
    clearTimeout(autoCommitTimer);
  });
  actions.append(confirmBtn, dismissBtn);
  toast.appendChild(actions);
  toastContainer.appendChild(toast);

  // M-3: auto-commit after 30 s if the user ignores the toast
  const autoCommitTimer = setTimeout(async () => {
    if (!toast.parentNode) return; // user already acted
    toast.remove();
    try {
      const res = await apiFetch(API.gitCommit, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: autoSlug }),
      });
      if (res.ok) {
        showToast(`Auto-committed: ${autoSlug}`, 'info');
        await _onAfterCommit(autoSlug);
      }
    } catch { /* silent best-effort */ }
  }, AUTO_COMMIT_DELAY_MS);
}
