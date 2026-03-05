/**
 * Full-text search command palette.
 * Opens on Ctrl+P / Cmd+P or via SearchOverlay.open().
 */

export interface SearchOverlay {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

interface SearchResult {
  path:    string;
  title:   string;
  excerpt: string;
  score:   number;
}

type OpenPageFn = (path: string, title: string) => void;

const SEARCH_DEBOUNCE_MS = 200; // debounce delay before firing search request

export function initSearchOverlay(onOpenPage: OpenPageFn): SearchOverlay {
  // Create overlay DOM
  const overlay = document.createElement('div');
  overlay.id = 'search-overlay';
  overlay.className = 'hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Search pages');
  overlay.innerHTML = `
    <div id="search-box">
      <div id="search-input-row">
        <span id="search-icon">🔍</span>
        <input id="search-input" type="text" placeholder="Search pages…" autocomplete="off" spellcheck="false" />
        <kbd id="search-esc">Esc</kbd>
      </div>
      <div id="search-results" role="listbox"></div>
    </div>
    <div id="search-backdrop"></div>
  `;
  document.body.appendChild(overlay);

  const inputEl   = overlay.querySelector<HTMLInputElement>('#search-input')!;
  const resultsEl = overlay.querySelector<HTMLElement>('#search-results')!;
  const backdropEl = overlay.querySelector<HTMLElement>('#search-backdrop')!;

  let isOpen  = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedIdx = -1;
  let currentResults: SearchResult[] = [];

  /* ── Keyboard shortcuts ───────────────────────────────────────────── */

  // Escape closes overlay; Ctrl+P is wired in main.ts
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) doClose();
  });

  /* ── Backdrop click ───────────────────────────────────────────────────── */

  backdropEl.addEventListener('click', doClose);

  /* ── Input handling ───────────────────────────────────────────────────── */

  inputEl.addEventListener('input', () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
  });

  inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(selectedIdx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(selectedIdx - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = currentResults[selectedIdx];
      if (item) openResult(item);
    }
  });

  /* ── Result rendering ─────────────────────────────────────────────────── */

  function setSelected(idx: number): void {
    const count = currentResults.length;
    if (!count) return;
    selectedIdx = ((idx % count) + count) % count;
    resultsEl.querySelectorAll<HTMLElement>('.sr-item').forEach((el, i) => {
      el.setAttribute('aria-selected', String(i === selectedIdx));
      if (i === selectedIdx) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderResults(results: SearchResult[]): void {
    currentResults = results;
    selectedIdx = results.length > 0 ? 0 : -1;
    resultsEl.innerHTML = '';

    if (!results.length) {
      resultsEl.innerHTML = '<p class="sr-empty">No results</p>';
      return;
    }

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const item = document.createElement('div');
      item.className = 'sr-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(i === 0));
      item.dataset['path'] = r.path;

      const titleEl = document.createElement('div');
      titleEl.className = 'sr-title';
      titleEl.textContent = r.title;

      const pathEl = document.createElement('div');
      pathEl.className = 'sr-path';
      pathEl.textContent = r.path;

      item.appendChild(titleEl);
      item.appendChild(pathEl);

      if (r.excerpt) {
        const excerptEl = document.createElement('div');
        excerptEl.className = 'sr-excerpt';
        excerptEl.textContent = r.excerpt;
        item.appendChild(excerptEl);
      }

      item.addEventListener('click', () => openResult(r));
      item.addEventListener('mouseenter', () => setSelected(i));
      resultsEl.appendChild(item);
    }
  }

  /* ── Search API call ──────────────────────────────────────────────────── */

  async function runSearch(): Promise<void> {
    const q = inputEl.value.trim();
    if (!q) { renderResults([]); return; }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) { renderResults([]); return; }
      const data = await res.json() as SearchResult[];
      renderResults(data);
    } catch {
      renderResults([]);
    }
  }

  /* ── Open / close ─────────────────────────────────────────────────────── */

  function doOpen(): void {
    isOpen = true;
    overlay.classList.remove('hidden');
    inputEl.value = '';
    renderResults([]);
    setTimeout(() => inputEl.focus(), 50);
  }

  function doClose(): void {
    isOpen = false;
    overlay.classList.add('hidden');
    if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null; }
  }

  function openResult(r: SearchResult): void {
    doClose();
    onOpenPage(r.path, r.title);
  }

  return {
    open(): void  { doOpen(); },
    close(): void { doClose(); },
    get isOpen(): boolean { return isOpen; },
  };
}
