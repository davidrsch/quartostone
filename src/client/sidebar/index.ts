// src/client/sidebar/index.ts
// Renders the file tree from GET /api/pages and handles page selection.

export interface PageNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: PageNode[];
}

type SelectCallback = (path: string, name: string) => void;

export async function initSidebar(
  containerEl: HTMLElement,
  onSelect: SelectCallback,
): Promise<() => Promise<void>> {
  async function refresh() {
    const res = await fetch('/api/pages');
    if (!res.ok) {
      containerEl.innerHTML = '<p style="padding:12px;color:#f44747">Failed to load pages.</p>';
      return;
    }
    const nodes: PageNode[] = await res.json();
    containerEl.innerHTML = '';
    containerEl.appendChild(buildList(nodes, onSelect));
  }

  await refresh();
  return refresh;
}

function buildList(nodes: PageNode[], onSelect: SelectCallback): HTMLElement {
  const ul = document.createElement('div');
  for (const node of [...nodes].sort(sortNodes)) {
    ul.appendChild(buildNode(node, onSelect));
  }
  return ul;
}

function buildNode(node: PageNode, onSelect: SelectCallback): HTMLElement {
  const item = document.createElement('div');
  item.className = `tree-item ${node.type}`;
  item.dataset.path = node.path;

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = node.type === 'folder' ? '▶' : '○';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.name;

  item.append(icon, label);

  if (node.type === 'file') {
    item.addEventListener('click', () => {
      document.querySelectorAll('.tree-item.active').forEach((el) => el.classList.remove('active'));
      item.classList.add('active');
      onSelect(node.path, node.name);
    });
  } else if (node.type === 'folder' && node.children?.length) {
    let open = false;
    const children = document.createElement('div');
    children.className = 'tree-children';
    children.style.display = 'none';
    children.appendChild(buildList(node.children, onSelect));

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      open = !open;
      children.style.display = open ? 'block' : 'none';
      icon.textContent = open ? '▼' : '▶';
    });

    const wrapper = document.createElement('div');
    wrapper.append(item, children);
    return wrapper;
  }

  return item;
}

function sortNodes(a: PageNode, b: PageNode): number {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name);
}
