// src/client/treeNav.ts
// Pure keyboard-navigation helpers for the file tree (#114).
// Exported so they can be unit-tested independently.

/**
 * Move focus to the next (+1) or previous (-1) visible [role="treeitem"]
 * descendant within #file-tree.
 */
export function focusAdjacentTreeItem(current: HTMLElement, direction: 1 | -1): void {
  const tree = document.getElementById('file-tree');
  if (!tree) return;
  const items = Array.from(
    tree.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  ).filter(el => (el as HTMLElement & { offsetParent: Element | null }).offsetParent !== null);

  const idx = items.indexOf(current);
  if (idx === -1) return;
  items[idx + direction]?.focus();
}

/**
 * Returns all visible treeitem elements within a container.
 * Useful for testing — accepts an arbitrary root element, not just #file-tree.
 */
export function getVisibleTreeItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter(
    el => (el as HTMLElement & { offsetParent: Element | null }).offsetParent !== null,
  );
}
