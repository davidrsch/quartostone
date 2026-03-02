// src/client/branches/index.ts
// Branch picker — lists local branches, create/switch from the toolbar.

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
      const res = await fetch('/api/git/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        alert(`Failed to create branch: ${err.error ?? 'unknown'}`);
        return;
      }
      const { name: created } = await res.json() as { name: string };
      pickerLabel.textContent = created;
      onSwitched(created);
    } catch {
      alert('Failed to create branch: network error');
    }
  });

  async function renderBranches() {
    branchListEl.innerHTML = '<div style="padding:6px 12px;font-size:12px;color:var(--text-dim)">Loading…</div>';
    try {
      const res = await fetch('/api/git/branches');
      if (!res.ok) throw new Error('branches failed');
      const data: BranchesResponse = await res.json();

      branchListEl.innerHTML = '';
      for (const b of data.branches) {
        const item = document.createElement('div');
        item.className = `branch-item${b.current ? ' current' : ''}`;
        item.innerHTML = `<span class="branch-dot"></span><span>${b.name}</span>`;

        if (!b.current) {
          item.addEventListener('click', async () => {
            dropdown.classList.add('hidden');
            dropdownOpen = false;
            await switchBranch(b.name);
          });
        }

        branchListEl.appendChild(item);
      }
    } catch {
      branchListEl.innerHTML = '<div style="padding:6px 12px;font-size:12px;color:#f97171">Could not load branches</div>';
    }
  }

  async function switchBranch(branch: string) {
    try {
      const res = await fetch('/api/git/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      });
      const data = await res.json() as { ok?: boolean; branch?: string; stashConflict?: boolean; error?: string };
      if (!res.ok) {
        alert(`Could not switch to "${branch}": ${data.error ?? 'unknown error'}`);
        return;
      }
      pickerLabel.textContent = branch;
      onSwitched(branch, data.stashConflict);
    } catch {
      alert(`Could not switch branch: network error`);
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/git/branches');
      if (!res.ok) return;
      const data: BranchesResponse = await res.json();
      pickerLabel.textContent = data.current;
    } catch { /* silent */ }
  }

  // Initial load
  refresh();

  return { refresh };
}
