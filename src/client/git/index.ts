// src/client/git/index.ts
// Git sidebar panel — status strip, commit history list, inline diff viewer, remote sync

import { escHtml } from '../utils/escape.js';
import { showToast } from '../utils/toast.js';
import { API } from '../api/endpoints.js';

interface CommitEntry {
  hash: string;
  message: string;
  author_name: string;
  date: string;
}

interface StatusFile {
  path: string;
  index: string;
  working_dir: string;
}

interface GitStatus {
  files: StatusFile[];
  current: string;
  isClean?: boolean;
}

interface RemoteInfo {
  url: string;
  branch: string;
  tracking: string;
  ahead: number;
  behind: number;
}

type CommitCallback = (defaultMsg: string) => void;

/**
 * Initialises the Git sidebar panel.
 *
 * Renders the current branch, staged/unstaged file list, commit history,
 * inline diff viewer, and remote push/pull controls inside `containerEl`.
 *
 * @param containerEl  Host element for the git panel.
 * @param onCommitRequest  Called when the user requests a commit; receives a
 *   suggested auto-generated commit message.
 * @returns An object with a `refresh()` method to force a status/log reload.
 */
export async function initGitPanel(
  containerEl: HTMLElement,
  onCommitRequest: CommitCallback,
): Promise<{ refresh: () => Promise<void> }> {
  containerEl.innerHTML = `
    <div id="git-status-strip"></div>
    <div id="git-commit-bar">
      <button id="btn-git-commit-now">+ Commit</button>
    </div>
    <div id="git-remote-bar">
      <span id="git-sync-info" class="git-meta">No remote</span>
      <button id="btn-git-pull" class="btn-sync" disabled title="Pull (fast-forward only)">↓ Pull</button>
      <button id="btn-git-push" class="btn-sync" disabled title="Push to origin">↑ Push</button>
      <button id="btn-git-sync-settings" class="btn-sync-settings" title="Remote settings">⚙</button>
    </div>
    <div id="git-history-label">Recent commits</div>
    <div id="git-commit-list"></div>
    <div id="git-diff-panel" class="hidden">
      <div id="git-diff-header">
        <span id="git-diff-title"></span>
        <button id="btn-close-diff">×</button>
      </div>
      <pre id="git-diff-body"></pre>
    </div>
    <dialog id="git-remote-dialog">
      <h3>Remote settings</h3>
      <label>Remote URL<br>
        <input id="git-remote-url" type="text" placeholder="https://github.com/user/repo.git" />
      </label>
      <div class="dialog-actions">
        <button id="btn-remote-save">Save</button>
        <button id="btn-remote-cancel">Cancel</button>
      </div>
    </dialog>
  `;

  const statusStrip    = containerEl.querySelector<HTMLElement>('#git-status-strip')!;
  const commitList     = containerEl.querySelector<HTMLElement>('#git-commit-list')!;
  const diffPanel      = containerEl.querySelector<HTMLElement>('#git-diff-panel')!;
  const diffTitle      = containerEl.querySelector<HTMLElement>('#git-diff-title')!;
  const diffBody       = containerEl.querySelector<HTMLElement>('#git-diff-body')!;
  const btnCommit      = containerEl.querySelector<HTMLElement>('#btn-git-commit-now')!;
  const btnCloseDiff   = containerEl.querySelector<HTMLElement>('#btn-close-diff')!;
  const syncInfo       = containerEl.querySelector<HTMLElement>('#git-sync-info')!;
  const btnPull        = containerEl.querySelector<HTMLButtonElement>('#btn-git-pull')!;
  const btnPush        = containerEl.querySelector<HTMLButtonElement>('#btn-git-push')!;
  const btnSyncSettings = containerEl.querySelector<HTMLElement>('#btn-git-sync-settings')!;
  const remoteDialog   = containerEl.querySelector<HTMLDialogElement>('#git-remote-dialog')!;
  const remoteUrlInput = containerEl.querySelector<HTMLInputElement>('#git-remote-url')!;
  const btnRemoteSave  = containerEl.querySelector<HTMLElement>('#btn-remote-save')!;
  const btnRemoteCancel = containerEl.querySelector<HTMLElement>('#btn-remote-cancel')!;

  btnCommit.addEventListener('click', () => {
    const slug = `qs-${Math.random().toString(36).slice(2, 10)}`;
    onCommitRequest(slug);
  });

  btnCloseDiff.addEventListener('click', () => {
    diffPanel.classList.add('hidden');
  });

  btnSyncSettings.addEventListener('click', () => {
    remoteDialog.showModal();
  });

  btnRemoteCancel.addEventListener('click', () => {
    remoteDialog.close();
  });

  btnRemoteSave.addEventListener('click', async () => {
    try {
      const url = remoteUrlInput.value.trim();
      if (!url) return;
      const res = await fetch(API.gitRemote, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        remoteDialog.close();
        await loadRemote();
      } else {
        const err = await res.json() as { error?: string };
        showToast(`Failed to set remote: ${err.error ?? 'unknown error'}`, 'error');
      }
    } catch (err) {
      showToast(`Remote save failed: ${String(err)}`, 'error');
    }
  });

  btnPush.addEventListener('click', async () => {
    btnPush.disabled = true;
    btnPush.textContent = '↑ Pushing…';
    try {
      const res = await fetch(API.gitPush, { method: 'POST' });
      if (res.ok) {
        await loadRemote();
      } else {
        const err = await res.json() as { error?: string };
        showToast(`Push failed: ${err.error ?? 'unknown error'}`, 'error');
        btnPush.disabled = false;
        btnPush.textContent = '↑ Push';
      }
    } catch {
      showToast('Push failed: network error', 'error');
      btnPush.disabled = false;
      btnPush.textContent = '↑ Push';
    }
  });

  btnPull.addEventListener('click', async () => {
    btnPull.disabled = true;
    btnPull.textContent = '↓ Pulling…';
    try {
      const res = await fetch(API.gitPull, { method: 'POST' });
      if (res.ok) {
        await Promise.all([loadStatus(), loadHistory(), loadRemote()]);
      } else if (res.status === 409) {
        showToast('Pull failed: branches have diverged (not fast-forwardable). Please resolve manually.', 'error');
        btnPull.disabled = false;
        btnPull.textContent = '↓ Pull';
      } else {
        const err = await res.json() as { error?: string };
        showToast(`Pull failed: ${err.error ?? 'unknown error'}`, 'error');
        btnPull.disabled = false;
        btnPull.textContent = '↓ Pull';
      }
    } catch {
      showToast('Pull failed: network error', 'error');
      btnPull.disabled = false;
      btnPull.textContent = '↓ Pull';
    }
  });

  async function loadStatus() {
    try {
      const res = await fetch(API.gitStatus);
      if (!res.ok) throw new Error('status failed');
      const s = await res.json() as GitStatus;
      renderStatus(statusStrip, s);
    } catch {
      statusStrip.innerHTML = '<span class="git-meta">Could not read git status.</span>';
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch(API.gitLog);
      if (!res.ok) throw new Error('log failed');
      const commits = await res.json() as CommitEntry[];
      renderHistory(commitList, commits, async (hash, msg) => {
        diffTitle.textContent = `${hash.slice(0, 7)} · ${msg}`;
        diffBody.textContent = 'Loading…';
        diffPanel.classList.remove('hidden');
        const dr = await fetch(`${API.gitDiff}?sha=${hash}`);
        if (!dr.ok) {
          diffBody.textContent = 'Failed to load diff.';
          return;
        }
        const d = await dr.json() as { diff: string };
        diffBody.textContent = d.diff;
        colorDiff(diffBody);
      });
    } catch {
      commitList.innerHTML = '<span class="git-meta">No commits yet.</span>';
    }
  }

  async function loadRemote() {
    try {
      const res = await fetch(API.gitRemote);
      if (!res.ok) {
        syncInfo.textContent = 'No remote';
        btnPush.disabled = true;
        btnPull.disabled = true;
        return;
      }
      const info = await res.json() as RemoteInfo;
      remoteUrlInput.value = info.url;
      const parts: string[] = [];
      if (info.ahead > 0) parts.push(`↑${info.ahead}`);
      if (info.behind > 0) parts.push(`↓${info.behind}`);
      if (parts.length === 0) parts.push('✓ up-to-date');
      syncInfo.textContent = `${parts.join(' ')} · ${info.tracking || info.branch}`;
      btnPush.disabled = info.ahead === 0;
      btnPush.textContent = info.ahead > 0 ? `↑ Push ${info.ahead}` : '↑ Push';
      btnPull.disabled = info.behind === 0;
      btnPull.textContent = info.behind > 0 ? `↓ Pull ${info.behind}` : '↓ Pull';
    } catch {
      syncInfo.textContent = 'Remote unavailable';
      btnPush.disabled = true;
      btnPull.disabled = true;
    }
  }

  async function refresh() {
    await Promise.all([loadStatus(), loadHistory(), loadRemote()]);
  }

  await refresh();
  return { refresh };
}

function renderStatus(el: HTMLElement, status: GitStatus) {
  const branch = status.current ?? 'unknown';
  const files = status.files ?? [];
  const dirty = files.length > 0;
  el.innerHTML = `
    <div class="git-branch">⎇ ${escHtml(branch)}${dirty ? ' · <span class="git-dirty">' + files.length + ' changed</span>' : ' <span class="git-clean">✓ clean</span>'}</div>
    ${files.slice(0, 8).map(f => `<div class="git-file-row">
      <span class="git-badge ${badgeClass(f)}">${badgeLabel(f)}</span>
      <span class="git-file-path">${escHtml(f.path)}</span>
    </div>`).join('')}
    ${files.length > 8 ? `<div class="git-meta">…and ${files.length - 8} more</div>` : ''}
  `;
}

function renderHistory(
  el: HTMLElement,
  commits: CommitEntry[],
  onDiff: (hash: string, msg: string) => void,
) {
  if (!commits.length) {
    el.innerHTML = '<span class="git-meta">No commits yet.</span>';
    return;
  }
  el.innerHTML = commits.map(c => `
    <div class="git-commit-row" data-hash="${escHtml(c.hash)}">
      <div class="git-commit-hash">${escHtml(c.hash.slice(0, 7))}</div>
      <div class="git-commit-msg">${escHtml(c.message)}</div>
      <div class="git-commit-meta">${escHtml(c.author_name)} · ${formatDate(c.date)}</div>
    </div>
  `).join('');

  el.querySelectorAll<HTMLElement>('.git-commit-row').forEach(row => {
    row.addEventListener('click', () => {
      el.querySelectorAll('.git-commit-row.active').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      const hash = row.dataset['hash']!;
      const msg = row.querySelector<HTMLElement>('.git-commit-msg')?.textContent ?? '';
      onDiff(hash, msg);
    });
  });
}

function colorDiff(pre: HTMLElement) {
  const lines = (pre.textContent ?? '').split('\n');
  pre.innerHTML = lines.map(line => {
    if (line.startsWith('+') && !line.startsWith('+++'))
      return `<span class="diff-add">${escHtml(line)}</span>`;
    if (line.startsWith('-') && !line.startsWith('---'))
      return `<span class="diff-del">${escHtml(line)}</span>`;
    if (line.startsWith('@@'))
      return `<span class="diff-hunk">${escHtml(line)}</span>`;
    return escHtml(line);
  }).join('\n');
}

function badgeClass(f: StatusFile): string {
  const ch = (f.index + f.working_dir).replace(/\s/g, '');
  if (ch.includes('A')) return 'badge-added';
  if (ch.includes('D')) return 'badge-deleted';
  return 'badge-modified';
}

function badgeLabel(f: StatusFile): string {
  const ch = (f.index + f.working_dir).replace(/\s/g, '');
  if (ch.includes('A')) return 'A';
  if (ch.includes('D')) return 'D';
  return 'M';
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}


