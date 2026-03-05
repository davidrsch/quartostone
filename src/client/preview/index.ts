/**
 * Preview panel — manages the split-pane live preview iframe.
 * Communicates with the server /api/preview/* routes.
 */

import { API } from '../api/endpoints.js';

export interface PreviewPanel {
  /** Call when the active page path changes; starts/updates preview if active. */
  setPage(path: string | null): void | Promise<void>;
  /** Programmatically stop the preview and hide the pane. */
  stop(): void;
  /** Whether the preview pane is currently visible. */
  readonly isActive: boolean;
}

interface PreviewStartResponse {
  port: number;
  url: string;
  reused: boolean;
}

export function initPreviewPanel(): PreviewPanel {
  const btnPreview  = document.getElementById('btn-preview')    as HTMLButtonElement | null;
  const pane        = document.getElementById('preview-pane');
  const resizer     = document.getElementById('preview-resizer');
  const frame       = document.getElementById('preview-frame')  as HTMLIFrameElement | null;
  const loadingEl   = document.getElementById('preview-loading');
  const errorEl     = document.getElementById('preview-error');

  let active       = false;
  let currentPath: string | null = null;

  /* ── Helpers ──────────────────────────────────────────────────────────── */

  function setLoading(v: boolean): void {
    if (!loadingEl) return;
    loadingEl.classList.toggle('hidden', !v);
  }

  function setError(msg: string | null): void {
    if (!errorEl) return;
    if (msg) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    } else {
      errorEl.classList.add('hidden');
    }
  }

  function showPane(): void {
    pane?.classList.remove('hidden');
    resizer?.classList.remove('hidden');
  }

  function hidePane(): void {
    pane?.classList.add('hidden');
    resizer?.classList.add('hidden');
  }

  /* ── Start preview for a path ─────────────────────────────────────────── */

  async function startPreview(path: string): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(API.previewStart, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(err.error ?? res.statusText);
      }

      const data = await res.json() as PreviewStartResponse;

      // #118 — Use server-side TCP readiness poll instead of client-side fetch polling.
      // The server checks the TCP port directly which is more reliable than a CORS fetch.
      const readyRes = await fetch(`${API.previewReady}?port=${data.port}&timeout=20000`);
      if (!readyRes.ok) {
        setError(`Preview server readiness check failed (HTTP ${readyRes.status})`);
        return;
      }
      const readyData = await readyRes.json().catch(() => ({ ready: false })) as { ready: boolean };
      if (frame) frame.src = data.url; // set regardless; best-effort
      showPane();
    } catch (err) {
      setError('Preview failed: ' + String(err));
      showPane();
    } finally {
      setLoading(false);
    }
  }

  /* ── Stop preview ─────────────────────────────────────────────────────── */

  async function stopPreview(path: string): Promise<void> {
    try {
      await fetch(API.previewStop, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
    } catch { /* best effort */ }
  }

  /* ── Toggle button ────────────────────────────────────────────────────── */

  btnPreview?.addEventListener('click', async () => {
    if (!active) {
      active = true;
      btnPreview.classList.add('active');
      if (currentPath) await startPreview(currentPath);
    } else {
      active = false;
      btnPreview.classList.remove('active');
      hidePane();
      if (frame) frame.src = 'about:blank';
      if (currentPath) await stopPreview(currentPath);
    }
  });

  /* ── Drag-to-resize ───────────────────────────────────────────────────── */

  if (resizer && pane) {
    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e: MouseEvent) => {
      dragging = true;
      startX = e.clientX;
      startWidth = pane.offsetWidth;
      resizer.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMove = (e: MouseEvent) => {
        if (!dragging) return;
        const delta = startX - e.clientX;
        const newWidth = Math.max(200, Math.min(startWidth + delta, window.innerWidth * 0.75));
        pane.style.width = newWidth + 'px';
        pane.style.flex = 'none';
      };

      const onUp = () => {
        dragging = false;
        resizer.classList.remove('dragging');
        document.body.style.removeProperty('user-select');
        document.body.style.removeProperty('cursor');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /* ── Hide loading overlay once iframe actually loads ─────────────────── */

  frame?.addEventListener('load', () => {
    if (frame.src !== 'about:blank') {
      setLoading(false);
    }
  });

  /* ── Public API ───────────────────────────────────────────────────────── */

  return {
    get isActive(): boolean { return active; },

    async setPage(path: string | null): Promise<void> {
      currentPath = path;
      if (btnPreview) btnPreview.disabled = path === null;

      if (!active || !path) return;

      // If the path changed, start fresh
      await startPreview(path);
    },

    async stop(): Promise<void> {
      if (!active) return;
      active = false;
      btnPreview?.classList.remove('active');
      hidePane();
      if (frame) frame.src = 'about:blank';
      if (currentPath) await stopPreview(currentPath);
    },
  };
}
