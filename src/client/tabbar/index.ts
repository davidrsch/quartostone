// src/client/tabbar/index.ts
// Reusable tab bar manager — eliminates duplication between primary (#112) and secondary (#140) panes.

export interface TabEntry {
  path: string;
  name: string;
  dirty: boolean;
}

/**
 * Manages a tab bar DOM element for a single editor pane.
 * Provides ensure/close/markDirty/render/clear primitives.
 */
export class TabBarManager {
  private readonly tabs: TabEntry[] = [];
  private activeTabPath: string | null = null;

  constructor(
    public readonly barId: string,
    /** Called when the user clicks a tab, or when a closed active tab's neighbor should open. */
    private readonly onOpen: (path: string, name: string) => void,
    /** Called when the last tab is closed (activeTabPath is already null at this point). */
    private readonly onAllClosed: () => void = () => {},
    /** Called when a tab from a DIFFERENT TabBarManager is dropped here. */
    private readonly onExternalDrop?: (path: string, name: string, sourceBarId: string) => void,
  ) {}

  render(): void {
    const bar = document.getElementById(this.barId);
    if (!bar) return;
    bar.innerHTML = '';
    for (const tab of this.tabs) {
      const el = document.createElement('div');
      el.className = 'editor-tab' + (tab.path === this.activeTabPath ? ' active' : '');
      el.title = tab.path;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(tab.path === this.activeTabPath));
      el.dataset['path'] = tab.path;
      el.draggable = true;

      el.addEventListener('dragstart', e => {
        if (e.dataTransfer) {
          e.dataTransfer.setData('application/json', JSON.stringify({
            barId: this.barId,
            path: tab.path,
            name: tab.name
          }));
          e.dataTransfer.effectAllowed = 'move';
        }
      });

      const dot = document.createElement('span');
      dot.className = 'editor-tab-dot';
      dot.style.visibility = tab.dirty ? 'visible' : 'hidden';

      const name = document.createElement('span');
      name.className = 'editor-tab-name';
      name.textContent = tab.name;

      const close = document.createElement('button');
      close.className = 'editor-tab-close';
      close.title = 'Close tab';
      close.setAttribute('aria-label', `Close ${tab.name}`);
      close.textContent = '×';
      close.addEventListener('click', ev => {
        ev.stopPropagation();
        this.close(tab.path);
      });

      el.append(dot, name, close);
      el.addEventListener('click', () => {
        if (tab.path !== this.activeTabPath) this.onOpen(tab.path, tab.name);
      });
      bar.appendChild(el);
    }

    // Handle dropping tabs into this bar
    bar.ondragover = e => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };

    bar.ondrop = e => {
      e.preventDefault();
      if (!e.dataTransfer) return;
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        if (!data || !data.path || !data.barId) return;

        if (data.barId === this.barId) {
          // Internal reorder
          const draggedIdx = this.tabs.findIndex(t => t.path === data.path);
          if (draggedIdx === -1) return;
          // Determine drop index based on mouse X
          let dropIdx = this.tabs.length;
          const children = Array.from(bar.children);
          for (let i = 0; i < children.length; i++) {
            const rect = children[i].getBoundingClientRect();
            if (e.clientX < rect.left + rect.width / 2) {
              dropIdx = i;
              break;
            }
          }
          const [draggedTab] = this.tabs.splice(draggedIdx, 1);
          if (dropIdx > draggedIdx) dropIdx--; // adjust since we removed it
          this.tabs.splice(dropIdx, 0, draggedTab);
          this.render();
        } else {
          // External drop (from another pane)
          if (this.onExternalDrop) {
            this.onExternalDrop(data.path, data.name, data.barId);
          }
        }
      } catch (err) {
        // Ignore parsing errors for non-tab drops
      }
    };
  }

  /** Add tab if not present, set it active, and re-render. */
  ensure(path: string, name: string): void {
    if (!this.tabs.find(t => t.path === path)) {
      this.tabs.push({ path, name, dirty: false });
    }
    this.activeTabPath = path;
    this.render();
  }

  /** Remove a tab; if it was active, open the nearest neighbor or call onAllClosed. */
  close(path: string): void {
    const idx = this.tabs.findIndex(t => t.path === path);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    if (this.activeTabPath === path) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1];
      if (next) {
        this.onOpen(next.path, next.name);
      } else {
        this.activeTabPath = null;
        this.onAllClosed();
      }
    }
    this.render();
  }

  markDirty(path: string, dirty: boolean): void {
    const tab = this.tabs.find(t => t.path === path);
    if (tab) { tab.dirty = dirty; this.render(); }
  }

  /** Remove all tabs and reset active path (used when tearing down a pane). */
  clear(): void {
    this.tabs.length = 0;
    this.activeTabPath = null;
  }
}
