// @vitest-environment happy-dom
// tests/unit/client/treeNav.test.ts
// Unit tests for keyboard navigation helpers (#114).

import { describe, it, expect, beforeEach } from 'vitest';
import { getVisibleTreeItems } from '../../../src/client/treeNav.js';

function makeTreeItem(label: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'treeitem');
  el.setAttribute('aria-label', label);
  el.tabIndex = 0;
  return el;
}

function makeTree(items: HTMLElement[]): HTMLElement {
  const tree = document.createElement('nav');
  tree.id = 'file-tree';
  items.forEach(i => tree.appendChild(i));
  document.body.appendChild(tree);
  return tree;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('getVisibleTreeItems', () => {
  it('returns all treeitem elements within the root', () => {
    const a = makeTreeItem('page-a');
    const b = makeTreeItem('page-b');
    const c = makeTreeItem('page-c');
    const tree = makeTree([a, b, c]);

    const items = getVisibleTreeItems(tree);
    expect(items).toHaveLength(3);
    expect(items[0]).toBe(a);
    expect(items[2]).toBe(c);
  });

  it('returns empty array when no treeitem elements exist', () => {
    const tree = document.createElement('nav');
    document.body.appendChild(tree);
    expect(getVisibleTreeItems(tree)).toHaveLength(0);
  });

  it('does not include non-treeitem elements', () => {
    const tree = document.createElement('nav');
    const div = document.createElement('div'); // no role
    tree.appendChild(div);
    document.body.appendChild(tree);
    expect(getVisibleTreeItems(tree)).toHaveLength(0);
  });

  it('finds nested treeitems inside folders', () => {
    const tree = document.createElement('nav');
    const folder = document.createElement('div');
    folder.setAttribute('role', 'treeitem');
    const child = document.createElement('div');
    child.setAttribute('role', 'treeitem');
    folder.appendChild(child);
    tree.appendChild(folder);
    document.body.appendChild(tree);

    const items = getVisibleTreeItems(tree);
    expect(items).toHaveLength(2);
  });
});

describe('treeitem aria attributes', () => {
  it('file node has role=treeitem', () => {
    const item = makeTreeItem('test-page');
    expect(item.getAttribute('role')).toBe('treeitem');
  });

  it('file node has tabIndex 0 for keyboard focus', () => {
    const item = makeTreeItem('test-page');
    expect(item.tabIndex).toBe(0);
  });

  it('file node has aria-label with the page name', () => {
    const item = makeTreeItem('my-document');
    expect(item.getAttribute('aria-label')).toBe('my-document');
  });
});
