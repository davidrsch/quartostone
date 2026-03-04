/**
 * Backlinks sidebar panel.
 * Shows pages that link TO the currently-open page using [[wiki links]] syntax.
 */

export interface BacklinksPanel {
  /** Update the panel for a new page (or clear when null) */
  setPage(path: string | null): void;
  /** Refresh backlinks for the current page (e.g., after save) */
  refresh(): void;
}

interface BacklinkEntry {
  path:    string;
  title:   string;
  excerpt: string;
}

export type OpenPageFn = (path: string, title: string) => void;

export function initBacklinksPanel(
  containerEl: HTMLElement,
  onOpenPage: OpenPageFn,
): BacklinksPanel {
  let currentPath: string | null = null;

  function render(entries: BacklinkEntry[]): void {
    containerEl.innerHTML = '';

    if (!currentPath) {
      containerEl.innerHTML = '<p class="bl-empty">No page open.</p>';
      return;
    }

    if (!entries.length) {
      containerEl.innerHTML = '<p class="bl-empty">No pages link here.</p>';
      return;
    }

    const heading = document.createElement('p');
    heading.className = 'bl-count';
    heading.textContent = `${entries.length} page${entries.length !== 1 ? 's' : ''} link here`;
    containerEl.appendChild(heading);

    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'bl-item';

      const btn = document.createElement('button');
      btn.className = 'bl-title';
      btn.dataset['path'] = entry.path;
      btn.textContent = entry.title;
      btn.addEventListener('click', () => {
        onOpenPage(entry.path, entry.title);
      });
      item.appendChild(btn);

      if (entry.excerpt) {
        const p = document.createElement('p');
        p.className = 'bl-excerpt';
        p.textContent = `"${entry.excerpt}"`;
        item.appendChild(p);
      }

      containerEl.appendChild(item);
    }
  }

  async function load(path: string): Promise<void> {
    containerEl.innerHTML = '<p class="bl-empty">Loading…</p>';
    try {
      const res = await fetch(`/api/links/backlinks?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(res.statusText);
      const entries = await res.json() as BacklinkEntry[];
      render(entries);
    } catch {
      containerEl.innerHTML = '<p class="bl-empty bl-error">Failed to load backlinks.</p>';
    }
  }

  return {
    setPage(path): void {
      currentPath = path;
      if (path) {
        void load(path);
      } else {
        render([]);
      }
    },
    refresh(): void {
      if (currentPath) void load(currentPath);
    },
  };
}
