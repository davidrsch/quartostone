// src/client/ui/statusBar.ts
// Status bar: branch display, sync indicator, polling, and click handlers.

import { apiFetch } from '../api/request.js';
import { API } from '../api/endpoints.js';

const GIT_STATUS_POLL_INTERVAL_MS = 30_000;

export async function updateBranchStatus(): Promise<void> {
  const sbBranch = document.getElementById('sb-branch')!;
  const sbSync   = document.getElementById('sb-sync')!;
  try {
    const res = await apiFetch(API.gitStatus);
    if (!res.ok) {
      sbBranch.textContent = '';
      sbSync.textContent = '';
      sbSync.classList.add('hidden');
      return;
    }
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
    sbSync.textContent   = '';
    sbSync.classList.add('hidden');
  }
}

/** Wire status-bar click handlers and start the polling interval. Call once at boot. */
export function initStatusBar(): void {
  // Click on ahead/behind badge → open Git panel
  document.getElementById('sb-sync')?.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('.stab[data-tab="git"]')?.click();
  });

  // #116: sb-branch → open branch picker
  const sbBranchBtn = document.getElementById('sb-branch') as HTMLButtonElement | null;
  sbBranchBtn?.addEventListener('click', () => {
    (document.getElementById('btn-branch-picker') as HTMLButtonElement)?.click();
  });

  // #117: sb-save-status → open Git panel
  document.getElementById('sb-save-status')?.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('.stab[data-tab="git"]')?.click();
  });

  void updateBranchStatus();
  setInterval(updateBranchStatus, GIT_STATUS_POLL_INTERVAL_MS);
}
