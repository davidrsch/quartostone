/**
 * Export picker — handles the Export toolbar dropdown, format selection,
 * polling for job completion, and triggering the file download.
 */

import { showToast } from '../utils/toast.js';
import { API } from '../api/endpoints.js';
import { apiFetch } from '../api/request.js';

interface ExportJobStatus {
  token: string;
  status: 'pending' | 'running' | 'done' | 'error';
  filename?: string;
  error?: string;
}

/** Returns the currently-active page path from the editor, or null. */
export type GetCurrentPathFn = () => string | null;

export function initExportPicker(getCurrentPath: GetCurrentPathFn): { setPageReady(ready: boolean): void } {
  const picker = document.getElementById('export-picker');
  const btnExport = document.getElementById('btn-export') as HTMLButtonElement | null;
  const dropdown = document.getElementById('export-dropdown');

  if (!picker || !btnExport || !dropdown) return { setPageReady() { } };

  /* ── Toggle dropdown ──────────────────────────────────────────────────── */

  function openDropdown(): void {
    dropdown!.classList.remove('hidden');
    document.addEventListener('click', closeOnOutside, { capture: true, once: true });
  }

  function closeDropdown(): void {
    dropdown!.classList.add('hidden');
  }

  function closeOnOutside(e: Event): void {
    if (!picker!.contains(e.target as Node)) {
      closeDropdown();
    } else {
      // Click was inside — re-attach listener so it fires again
      document.addEventListener('click', closeOnOutside, { capture: true, once: true });
    }
  }

  btnExport.addEventListener('click', () => {
    if (dropdown.classList.contains('hidden')) {
      openDropdown();
    } else {
      closeDropdown();
    }
  });

  /* ── Format buttons ───────────────────────────────────────────────────── */

  dropdown.querySelectorAll<HTMLButtonElement>('.export-item').forEach(btn => {
    btn.addEventListener('click', () => {
      closeDropdown();
      const format = btn.dataset['format'];
      if (!format) return;
      if (format === 'custom') {
        openCustomDialog();
      } else {
        startExport(format, []);
      }
    });
  });

  /* ── Custom dialog ────────────────────────────────────────────────────── */

  const dialog = document.getElementById('custom-export-dialog') as HTMLDialogElement | null;
  const fmtInput = document.getElementById('custom-format-input') as HTMLInputElement | null;
  const argsInput = document.getElementById('custom-args-input') as HTMLInputElement | null;
  const confirmBtn = document.getElementById('btn-custom-export-confirm') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('btn-custom-export-cancel') as HTMLButtonElement | null;

  function openCustomDialog(): void {
    if (!dialog) return;
    if (fmtInput) fmtInput.value = '';
    if (argsInput) argsInput.value = '';
    dialog.showModal();
  }

  cancelBtn?.addEventListener('click', () => dialog?.close());

  confirmBtn?.addEventListener('click', () => {
    const format = fmtInput?.value.trim() ?? '';
    if (!format) return;
    const raw = argsInput?.value.trim() ?? '';
    const extra = raw ? raw.split(/\s+/) : [];
    dialog?.close();
    startExport(format, extra);
  });

  /* ── Core export flow ─────────────────────────────────────────────────── */


  async function startExport(format: string, extraArgs: string[]): Promise<void> {
    const path = getCurrentPath();
    if (!path) {
      showToast('Open a file before exporting.', 'error', 6000);
      return;
    }

    btnExport!.disabled = true;
    showToast(`Exporting as ${format}…`);

    let token: string;
    try {
      const res = await apiFetch(API.exportStart, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, format, extraArgs }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(err.error ?? res.statusText);
      }
      const data = await res.json() as { token: string };
      token = data.token;
    } catch (err) {
      showToast('Export failed: ' + String(err), 'error', 6000);
      btnExport!.disabled = false;
      return;
    }

    pollStatus(token);
  }

  function pollStatus(token: string): void {
    const INTERVAL = 800;
    const MAX_POLLS = 150; // ~2 min
    let count = 0;

    const id = setInterval(async () => {
      count++;
      if (count > MAX_POLLS) {
        clearInterval(id);
        showToast('Export timed out.', 'error', 6000);
        btnExport!.disabled = false;
        return;
      }

      let job: ExportJobStatus;
      try {
        const res = await apiFetch(`${API.exportStatus}?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          clearInterval(id);
          showToast('Export poll failed', 'error', 6000);
          btnExport!.disabled = false;
          return;
        }
        job = await res.json() as ExportJobStatus;
      } catch {
        return; // network hiccup — keep polling
      }

      if (job.status === 'done') {
        clearInterval(id);
        btnExport!.disabled = false;
        triggerDownload(token, job.filename ?? 'export');
      } else if (job.status === 'error') {
        clearInterval(id);
        btnExport!.disabled = false;
        showToast('Export error: ' + (job.error ?? 'unknown'), 'error', 6000);
      }
    }, INTERVAL);
  }

  function triggerDownload(token: string, filename: string): void {
    const a = document.createElement('a');
    a.href = `${API.exportDownload}?token=${encodeURIComponent(token)}`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(`Downloaded ${filename}`);
  }

  /* ── Return control object ────────────────────────────────────────────────── */
  return {
    setPageReady(ready: boolean) { btnExport.disabled = !ready; },
  };
}
