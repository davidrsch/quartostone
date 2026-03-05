// src/client/branches/index.ts
// Branch picker — lists local branches, create/switch from the toolbar.

import { API } from '../api/endpoints.js';

interface BranchEntry {
  name: string;
  current: boolean;
  sha: string;
}

interface BranchesResponse {
  current: string;
  branches: BranchEntry[];
}

export interface BranchPickerResult {
  refresh: () => Promise<void>;
}

export function initBranchPicker(
  onSwitched: (branch: string, stashConflict?: boolean) => void,
  showToast?: (msg: string, kind?: 'success' | 'error' | 'info') => void,
): BranchPickerResult {
  const pickerBtn     = document.getElementById('btn-branch-picker') as HTMLButtonElement;
  const pickerLabel   = document.getElementById('branch-picker-label')!;
  const dropdown      = document.getElementById('branch-dropdown')!;
  const branchListEl  = document.getElementById('branch-list')!;
  const btnNewBranch  = document.getElementById('btn-new-branch')!;
  const newBranchDialog = document.getElementById('new-branch-dialog') as HTMLDialogElement;
  const newBranchInput  = document.getElementById('new-branch-name') as HTMLInputElement;
  const btnConfirm      = document.getElementById('btn-new-branch-confirm')!;
  const btnCancel       = document.getElementById('btn-new-branch-cancel')!;

  let dropdownOpen = false;

  function toast(msg: string, kind: 'success' | 'error' | 'info' = 'error'): void {
    if (showToast) { showToast(msg, kind); } else { console.error(msg); }
  }

  // Toggle dropdown
  pickerBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    dropdownOpen = !dropdownOpen;
    if (dropdownOpen) {
      await renderBranches();
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
    }
  });

  // Close on outside click
  document.addEventListener('click', () => {
    if (dropdownOpen) {
      dropdown.classList.add('hidden');
      dropdownOpen = false;
    }
  });

  // Stop propagation inside dropdown (so outside-click handler doesn't fire)
  dropdown.addEventListener('click', e => e.stopPropagation());

  // New branch button opens dialog
  btnNewBranch.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    dropdownOpen = false;
    newBranchInput.value = '';
    newBranchDialog.showModal();
    newBranchInput.focus();
  });

  btnCancel.addEventListener('click', () => newBranchDialog.close());

  btnConfirm.addEventListener('click', async () => {
    const name = newBranchInput.value.trim();
    if (!name) return;
    newBranchDialog.close();
    try {
      const res = await fetch(API.gitBranches, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast(`Failed to create branch: ${err.error ?? 'unknown'}`);
        return;
      }
      const { name: created } = await res.json() as { name: string };
      pickerLabel.textContent = created;
      onSwitched(created);
    } catch {
      toast('Failed to create branch: network error');
    }
  });

  let _renderingBranches = false;

  async function renderBranches(): Promise<void> {
    if (_renderingBranches) return;
    _renderingBranches = true;
    branchListEl.innerHTML = '<div style="padding:6px 12px;font-size:12px;color:var(--text-dim)">Loading…</div>';
    try {
      const res = await fetch(API.gitBranches);
      if (!res.ok) throw new Error('branches failed');
      const data = await res.json() as BranchesResponse;

      branchListEl.innerHTML = '';
      for (const b of data.branches) {
        const item = document.createElement('div');
        item.className = `branch-item${b.current ? ' current' : ''}`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'branch-name';
        const dot = document.createElement('span');
        dot.className = 'branch-dot';
        nameSpan.textContent = '';
        nameSpan.appendChild(dot);
        nameSpan.appendChild(document.createTextNode(b.name));

        item.appendChild(nameSpan);

        if (!b.current) {
          // Switch button (whole left side)
          nameSpan.style.cursor = 'pointer';
          nameSpan.addEventListener('click', async () => {
            dropdown.classList.add('hidden');
            dropdownOpen = false;
            await switchBranch(b.name);
          });

          // Merge button
          const mergeBtn = document.createElement('button');
          mergeBtn.className = 'branch-merge-btn';
          mergeBtn.title = `Merge ${b.name} into current branch`;
          mergeBtn.textContent = '⤵ Merge';
          mergeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            dropdown.classList.add('hidden');
            dropdownOpen = false;
            await mergeBranch(b.name);
          });
          item.appendChild(mergeBtn);
        }

        branchListEl.appendChild(item);
      }
    } catch {
      branchListEl.innerHTML = '<div style="padding:6px 12px;font-size:12px;color:#f97171">Could not load branches</div>';
    } finally {
      _renderingBranches = false;
    }
  }

  async function switchBranch(branch: string) {
    try {
      const res = await fetch(API.gitCheckout, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      });
      if (!res.ok) {
        let msg = `Could not switch to "${branch}": unknown error`;
        try { const e = await res.json() as { error?: string }; msg = `Could not switch to "${branch}": ${e.error ?? 'unknown error'}`; } catch { /* ignore */ }
        toast(msg);
        return;
      }
      const data = await res.json() as { ok?: boolean; branch?: string; stashConflict?: boolean; error?: string };
      pickerLabel.textContent = branch;
      onSwitched(branch, data.stashConflict);
    } catch {
      toast(`Could not switch branch: network error`);
    }
  }

  async function mergeBranch(branch: string) {
    if (!confirm(`Merge "${branch}" into the current branch?`)) return;
    try {
      const res = await fetch(API.gitMerge, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      });
      const text = await res.text();
      if (res.status === 409) {
        // Conflict — show resolution modal (#100)
        let d: { conflicts?: string[] } = {};
        try { d = JSON.parse(text) as { conflicts?: string[] }; } catch { /* ignore */ }
        await showConflictModal(d.conflicts ?? []);
        return;
      }
      if (!res.ok) {
        let d: { error?: string } = {};
        try { d = JSON.parse(text) as { error?: string }; } catch { /* ignore */ }
        toast(`Merge failed: ${(d.error ?? text) || 'unknown error'}`);
        return;
      }
      let data: { ok?: boolean; commit?: string; error?: string; conflicts?: string[] };
      try {
        data = JSON.parse(text) as { ok?: boolean; commit?: string; error?: string; conflicts?: string[] };
      } catch {
        throw new Error('Server returned invalid JSON');
      }
      toast(`Merged "${branch}" successfully (${data.commit?.slice(0, 7) ?? '?'})`, 'success');
    } catch {
      toast('Merge failed: network error');
    }
  }

  async function showConflictModal(initialConflicts: string[]): Promise<void> {
    // Fetch fresh conflict list if not provided
    let conflicts = initialConflicts;
    if (conflicts.length === 0) {
      try {
        const r = await fetch(API.gitConflicts);
        if (!r.ok) throw new Error(`Failed to fetch conflicts: ${r.status}`);
        const d = await r.json() as { conflicted: string[] };
        conflicts = d.conflicted;
      } catch { /* ignore */ }
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-box conflict-modal';
    modal.innerHTML = `
      <h3 class="modal-title">⚠ Merge Conflict</h3>
      <p class="modal-desc">The following files have conflicts. Edit each file to resolve them, then click <strong>Complete Merge</strong>.</p>
    `;

    // Conflict file list
    const fileList = document.createElement('ul');
    fileList.className = 'conflict-file-list';
    for (const f of (conflicts.length > 0 ? conflicts : ['(no specific files reported)'])) {
      const li = document.createElement('li');
      li.className = 'conflict-file-item';
      const name = document.createElement('span');
      name.className = 'conflict-file-name';
      name.textContent = f;
      const resolvedBtn = document.createElement('button');
      resolvedBtn.type = 'button';
      resolvedBtn.className = 'conflict-resolved-btn';
      resolvedBtn.textContent = 'Resolved';
      resolvedBtn.addEventListener('click', () => {
        li.classList.add('resolved');
        resolvedBtn.disabled = true;
        resolvedBtn.textContent = '✓ Done';
      });
      li.append(name, resolvedBtn);
      fileList.appendChild(li);
    }
    modal.appendChild(fileList);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const completeBtn = document.createElement('button');
    completeBtn.type = 'button';
    completeBtn.className = 'modal-btn modal-btn-primary';
    completeBtn.textContent = '✓ Complete Merge';
    completeBtn.addEventListener('click', async () => {
      completeBtn.disabled = true;
      completeBtn.textContent = 'Completing…';
      try {
        const r = await fetch(API.gitMergeComplete, { method: 'POST' });
        const d = await r.json() as { ok?: boolean; commit?: string; error?: string };
        if (r.ok) {
          overlay.remove();
          toast(`Merge completed (${d.commit?.slice(0, 7) ?? '?'})`, 'success');
        } else {
          toast(`Could not complete merge: ${d.error ?? 'unknown error'}`);
          completeBtn.disabled = false;
          completeBtn.textContent = '✓ Complete Merge';
        }
      } catch {
        toast('Network error');
        completeBtn.disabled = false;
        completeBtn.textContent = '✓ Complete Merge';
      }
    });

    const abortBtn = document.createElement('button');
    abortBtn.type = 'button';
    abortBtn.className = 'modal-btn modal-btn-danger';
    abortBtn.textContent = '✕ Abort Merge';
    abortBtn.addEventListener('click', async () => {
      if (!confirm('Abort the merge? All merge changes will be discarded.')) return;
      abortBtn.disabled = true;
      abortBtn.textContent = 'Aborting…';
      try {
        const r = await fetch(API.gitMergeAbort, { method: 'POST' });
        if (r.ok) {
          overlay.remove();
          toast('Merge aborted — working tree restored.', 'success');
        } else {
          const d = await r.json() as { error?: string };
          toast(`Abort failed: ${d.error ?? 'unknown error'}`);
          abortBtn.disabled = false;
          abortBtn.textContent = '✕ Abort Merge';
        }
      } catch {
        toast('Network error');
        abortBtn.disabled = false;
        abortBtn.textContent = '✕ Abort Merge';
      }
    });

    actions.append(completeBtn, abortBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  async function refresh() {
    try {
      const res = await fetch(API.gitBranches);
      if (!res.ok) return;
      const data = await res.json() as BranchesResponse;
      pickerLabel.textContent = data.current;
    } catch { /* silent */ }
  }

  // Initial load
  refresh();

  return { refresh };
}
