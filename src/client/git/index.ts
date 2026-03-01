// src/client/git/index.ts
// Git sidebar panel — status strip, commit history list, inline diff viewer

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

type CommitCallback = (defaultMsg: string) => void;

export async function initGitPanel(
  containerEl: HTMLElement,
  onCommitRequest: CommitCallback,
): Promise<{ refresh: () => Promise<void> }> {
  containerEl.innerHTML = `
    <div id="git-status-strip"></div>
    <div id="git-commit-bar">
      <button id="btn-git-commit-now">+ Commit</button>
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
  `;

  const statusStrip = containerEl.querySelector<HTMLElement>('#git-status-strip')!;
  const commitList  = containerEl.querySelector<HTMLElement>('#git-commit-list')!;
  const diffPanel   = containerEl.querySelector<HTMLElement>('#git-diff-panel')!;
  const diffTitle   = containerEl.querySelector<HTMLElement>('#git-diff-title')!;
  const diffBody    = containerEl.querySelector<HTMLElement>('#git-diff-body')!;
  const btnCommit   = containerEl.querySelector<HTMLElement>('#btn-git-commit-now')!;
  const btnCloseDiff = containerEl.querySelector<HTMLElement>('#btn-close-diff')!;

  btnCommit.addEventListener('click', () => {
    const slug = `qs-${Math.random().toString(36).slice(2, 10)}`;
    onCommitRequest(slug);
  });

  btnCloseDiff.addEventListener('click', () => {
    diffPanel.classList.add('hidden');
  });

  async function loadStatus() {
    try {
      const res = await fetch('/api/git/status');
      if (!res.ok) throw new Error('status failed');
      const s: GitStatus = await res.json();
      renderStatus(statusStrip, s);
    } catch {
      statusStrip.innerHTML = '<span class="git-meta">Could not read git status.</span>';
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/git/log');
      if (!res.ok) throw new Error('log failed');
      const commits: CommitEntry[] = await res.json();
      renderHistory(commitList, commits, async (hash, msg) => {
        diffTitle.textContent = `${hash.slice(0, 7)} · ${msg}`;
        diffBody.textContent = 'Loading…';
        diffPanel.classList.remove('hidden');
        const dr = await fetch(`/api/git/diff?sha=${hash}`);
        const d = await dr.json() as { diff: string };
        diffBody.textContent = d.diff;
        colorDiff(diffBody);
      });
    } catch {
      commitList.innerHTML = '<span class="git-meta">No commits yet.</span>';
    }
  }

  async function refresh() {
    await Promise.all([loadStatus(), loadHistory()]);
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
    <div class="git-commit-row" data-hash="${c.hash}">
      <div class="git-commit-hash">${c.hash.slice(0, 7)}</div>
      <div class="git-commit-msg">${escHtml(c.message)}</div>
      <div class="git-commit-meta">${escHtml(c.author_name)} · ${formatDate(c.date)}</div>
    </div>
  `).join('');

  el.querySelectorAll<HTMLElement>('.git-commit-row').forEach(row => {
    row.addEventListener('click', () => {
      el.querySelectorAll('.git-commit-row.active').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      const hash = row.dataset.hash!;
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

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
