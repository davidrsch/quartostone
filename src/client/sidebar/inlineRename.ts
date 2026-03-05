// src/client/sidebar/inlineRename.ts
// Inline rename functionality for the sidebar tree.

import { showToast } from '../utils/toast.js';
import type { PageNode } from './index.js';

export function startRename(
  labelEl: HTMLSpanElement,
  node: PageNode,
  onRefresh: () => Promise<void>,
): void {
  const input = document.createElement('input');
  input.className = 'tree-rename-input';
  input.value = node.name;
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;

  async function commit() {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (!newName || newName === node.name) { input.replaceWith(labelEl); return; }
    // Replace only the last path segment; .qmd suffix is handled server-side
    const parts = node.path.replace(/\\/g, '/').split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');
    try {
      const urlPath = node.path.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(`/api/pages/${urlPath}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPath }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      await onRefresh();
    } catch (err) {
      showToast(`Rename failed: ${String(err)}`, 'error', 4000);
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); void commit(); }
    if (e.key === 'Escape') { committed = true; input.replaceWith(labelEl); }
  });
  input.addEventListener('blur', () => void commit());
}
