// src/client/breadcrumb.ts
// Breadcrumb navigation — renders the current file path above the editor (#139).
//
// The function is extracted from main.ts so it can be unit-tested independently
// of the full application bootstrap.

/**
 * Render a file-path breadcrumb inside `container`.
 *
 * @param path            The active file path (e.g. "notes/research/intro.qmd")
 *                        or `null` when no file is open.
 * @param container       The DOM element that will receive the rendered breadcrumb.
 * @param onFolderClick   Optional callback invoked with the cumulative segment path
 *                        (e.g. "notes/research") when a non-current segment is clicked.
 */
export function renderBreadcrumb(
  path: string | null,
  container: HTMLElement,
  onFolderClick?: (cumulativePath: string) => void,
): void {
  if (!path) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = '';

  const frag = document.createDocumentFragment();
  const clean = path.replace(/\.qmd$/i, '');
  const parts = clean.split('/').filter(Boolean);

  parts.forEach((seg, i) => {
    const isCurrent = i === parts.length - 1;
    const cumulativePath = parts.slice(0, i + 1).join('/');

    const span = document.createElement('span');
    span.className = isCurrent ? 'bc-seg bc-current' : 'bc-seg';
    span.textContent = seg;
    span.title = cumulativePath;
    span.setAttribute('aria-current', isCurrent ? 'page' : 'false');

    if (!isCurrent) {
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      span.addEventListener('click', () => {
        onFolderClick?.(cumulativePath);
      });
      span.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          span.click();
        }
      });
    }
    frag.appendChild(span);

    if (!isCurrent) {
      const sep = document.createElement('span');
      sep.className = 'bc-sep';
      sep.textContent = '/';
      sep.setAttribute('aria-hidden', 'true');
      frag.appendChild(sep);
    }
  });

  container.appendChild(frag);
}
