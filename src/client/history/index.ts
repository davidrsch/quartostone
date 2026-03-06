// src/client/history/index.ts
// Per-page commit timeline — shows commits that touched the current file,
// with a "Restore" button that checks the file out at that commit.

import { escHtml } from '../utils/escape.js';
import { API } from '../api/endpoints.js';
import { apiFetch } from '../api/request.js';

interface HistoryCommit {
  hash: string;
  message: string;
  author_name: string;
  date: string;
}

interface HistoryInitResult {
  /** Call when the user switches to a different page. */
  setPage: (path: string | null) => Promise<void>;
}

export async function initHistoryPanel(
  containerEl: HTMLElement,
  onRestored: (path: string, sha: string) => void,
): Promise<HistoryInitResult> {
  const emptyEl = containerEl.querySelector<HTMLElement>('#history-empty')!;
  const listEl = containerEl.querySelector<HTMLElement>('#history-list')!;

  let currentPath: string | null = null;

  async function loadHistory(path: string) {
    listEl.innerHTML = '<div class="history-loading">Loading…</div>';
    listEl.classList.remove('hidden');
    emptyEl.classList.add('hidden');

    try {
      const res = await apiFetch(`${API.gitLog}?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error('Failed to load history');
      const commits = await res.json() as HistoryCommit[];

      if (commits.length === 0) {
        listEl.innerHTML = '<div class="history-empty">No commits for this file yet.</div>';
        return;
      }

      listEl.innerHTML = '';
      for (const commit of commits) {
        const item = document.createElement('div');
        item.className = 'history-commit';

        const shortSha = commit.hash.slice(0, 7);
        const dateStr = new Date(commit.date).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', year: 'numeric',
        });

        item.innerHTML = `
          <button class="restore-btn" data-sha="${commit.hash}" title="Restore file to this version">↩</button>
          <div class="history-commit-msg" title="${escHtml(commit.message)}">${escHtml(commit.message)}</div>
          <div class="history-commit-meta">${shortSha} · ${escHtml(commit.author_name)} · ${dateStr}</div>
        `;

        item.querySelector<HTMLButtonElement>('.restore-btn')!
          .addEventListener('click', async (e) => {
            e.stopPropagation();
            const sha = (e.currentTarget as HTMLButtonElement).dataset['sha']!;
            await restoreFile(path, sha);
          });

        listEl.appendChild(item);
      }
    } catch (err) {
      listEl.innerHTML = `<div class="history-error">Could not load history: ${escHtml(String(err))}</div>`;
    }
  }

  async function restoreFile(path: string, sha: string) {
    if (!confirm(`Restore "${path}" to version ${sha.slice(0, 7)}?\n\nUnsaved changes will be lost.`)) return;
    try {
      const res = await apiFetch(API.gitRestore, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha, path }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        alert(`Restore failed: ${err.error ?? 'unknown error'}`);
        return;
      }
      onRestored(path, sha);
    } catch {
      alert('Restore failed: network error');
    }
  }

  async function setPage(path: string | null) {
    currentPath = path;
    if (!path) {
      listEl.classList.add('hidden');
      emptyEl.classList.remove('hidden');
      emptyEl.textContent = 'Open a page to see its history.';
      return;
    }
    await loadHistory(path);
  }

  // Expose refresh for outside callers (e.g. after a commit)
  (containerEl as HTMLElement & { refreshHistory?: () => Promise<void> }).refreshHistory = async () => {
    if (currentPath) await loadHistory(currentPath);
  };

  return { setPage };
}
