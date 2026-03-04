// @vitest-environment happy-dom
// tests/unit/client/preview.test.ts
// Unit tests for the preview panel module (#141).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { initPreviewPanel } from '../../../src/client/preview/index.js';

// ── DOM fixtures ──────────────────────────────────────────────────────────────

/** Build the minimal set of DOM elements that initPreviewPanel() needs. */
function buildPreviewDOM(): {
  btnPreview:  HTMLButtonElement;
  pane:        HTMLElement;
  resizer:     HTMLElement;
  frame:       HTMLIFrameElement;
  loadingEl:   HTMLElement;
  errorEl:     HTMLElement;
} {
  document.body.innerHTML = '';

  const btnPreview = document.createElement('button');
  btnPreview.id = 'btn-preview';

  const pane = document.createElement('div');
  pane.id = 'preview-pane';
  pane.classList.add('hidden');

  const resizer = document.createElement('div');
  resizer.id = 'preview-resizer';
  resizer.classList.add('hidden');

  const frame = document.createElement('iframe');
  frame.id = 'preview-frame';

  const loadingEl = document.createElement('div');
  loadingEl.id = 'preview-loading';
  loadingEl.classList.add('hidden');

  const errorEl = document.createElement('div');
  errorEl.id = 'preview-error';
  errorEl.classList.add('hidden');

  document.body.append(btnPreview, pane, resizer, frame, loadingEl, errorEl);

  return { btnPreview, pane, resizer, frame, loadingEl, errorEl };
}

/** Stub fetch so startPreview succeeds in under one microtask. */
function stubStartPreview(port = 4444) {
  return vi.fn().mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes('/api/preview/start')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ port, url: `http://localhost:${port}/`, reused: false }),
      });
    }
    if (u.includes('/api/preview/ready')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ready: true }),
      });
    }
    if (u.includes('/api/preview/stop')) {
      return Promise.resolve({ ok: true });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'not found' }) });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe('initPreviewPanel — initial state', () => {
  it('isActive is false before any interaction', () => {
    buildPreviewDOM();
    const panel = initPreviewPanel();
    expect(panel.isActive).toBe(false);
  });

  it('pane is hidden initially', () => {
    const { pane } = buildPreviewDOM();
    initPreviewPanel();
    expect(pane.classList.contains('hidden')).toBe(true);
  });

  it('preview button is disabled when setPage receives null', () => {
    const { btnPreview } = buildPreviewDOM();
    const panel = initPreviewPanel();
    panel.setPage(null);
    expect(btnPreview.disabled).toBe(true);
  });

  it('preview button is enabled after setPage is called with a path', () => {
    const { btnPreview } = buildPreviewDOM();
    vi.stubGlobal('fetch', stubStartPreview());
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');
    expect(btnPreview.disabled).toBe(false);
  });
});

// ── Button click ──────────────────────────────────────────────────────────────

describe('initPreviewPanel — button click toggles active state', () => {
  it('clicking btn-preview sets isActive to true', async () => {
    const { btnPreview } = buildPreviewDOM();
    vi.stubGlobal('fetch', stubStartPreview());
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');

    btnPreview.click();
    expect(panel.isActive).toBe(true);
  });

  it('clicking btn-preview adds .active class to the button', async () => {
    const { btnPreview } = buildPreviewDOM();
    vi.stubGlobal('fetch', stubStartPreview());
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');

    btnPreview.click();
    expect(btnPreview.classList.contains('active')).toBe(true);
  });

  it('clicking btn-preview a second time sets isActive to false', async () => {
    const { btnPreview } = buildPreviewDOM();
    vi.stubGlobal('fetch', stubStartPreview());
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');

    btnPreview.click(); // activate
    btnPreview.click(); // deactivate
    expect(panel.isActive).toBe(false);
  });

  it('clicking btn-preview a second time removes .active class', async () => {
    const { btnPreview } = buildPreviewDOM();
    vi.stubGlobal('fetch', stubStartPreview());
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');

    btnPreview.click();
    btnPreview.click();
    expect(btnPreview.classList.contains('active')).toBe(false);
  });

  it('clicking btn-preview a second time hides the pane', async () => {
    const { btnPreview, pane } = buildPreviewDOM();
    vi.stubGlobal('fetch', stubStartPreview());
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');

    btnPreview.click();
    // Wait for async startPreview to settle
    await new Promise(r => setTimeout(r, 0));
    btnPreview.click();
    expect(pane.classList.contains('hidden')).toBe(true);
  });
});

// ── stop() public API ─────────────────────────────────────────────────────────

describe('initPreviewPanel — stop()', () => {
  it('stop() when not active resolves immediately without error', async () => {
    buildPreviewDOM();
    const panel = initPreviewPanel();
    await expect(panel.stop()).resolves.toBeUndefined();
  });

  it('stop() after activation sets isActive to false', async () => {
    const { btnPreview } = buildPreviewDOM();
    vi.stubGlobal('fetch', stubStartPreview());
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');

    btnPreview.click();
    await panel.stop();
    expect(panel.isActive).toBe(false);
  });

  it('stop() after activation removes .active class from button', async () => {
    const { btnPreview } = buildPreviewDOM();
    vi.stubGlobal('fetch', stubStartPreview());
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');

    btnPreview.click();
    await panel.stop();
    expect(btnPreview.classList.contains('active')).toBe(false);
  });

  it('stop() hides the preview pane', async () => {
    const { btnPreview, pane } = buildPreviewDOM();
    vi.stubGlobal('fetch', stubStartPreview());
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');

    btnPreview.click();
    await new Promise(r => setTimeout(r, 0));
    await panel.stop();
    expect(pane.classList.contains('hidden')).toBe(true);
  });

  it('stop() resets iframe src to about:blank', async () => {
    const { btnPreview, frame } = buildPreviewDOM();
    vi.stubGlobal('fetch', stubStartPreview());
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');

    btnPreview.click();
    await new Promise(r => setTimeout(r, 0));
    await panel.stop();
    expect(frame.src).toBe('about:blank');
  });
});

// ── Error display ─────────────────────────────────────────────────────────────

describe('initPreviewPanel — error display', () => {
  it('shows error text when startPreview returns a non-ok response', async () => {
    const { btnPreview, errorEl } = buildPreviewDOM();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'quarto not found' }),
    }));
    const panel = initPreviewPanel();
    panel.setPage('fail.qmd');

    btnPreview.click();
    // Wait for async rejection to propagate
    await new Promise(r => setTimeout(r, 50));

    expect(errorEl.classList.contains('hidden')).toBe(false);
    expect(errorEl.textContent).toContain('Preview failed');
  });

  it('error element is hidden again when stop() is called after an error', async () => {
    const { btnPreview } = buildPreviewDOM();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Error',
      json: () => Promise.resolve({ error: 'fail' }),
    }));
    const panel = initPreviewPanel();
    panel.setPage('fail.qmd');

    btnPreview.click();
    await new Promise(r => setTimeout(r, 50));

    // Second click deactivates and hides pane+error
    btnPreview.click();
    expect(panel.isActive).toBe(false);
  });
});

// ── setPage() ─────────────────────────────────────────────────────────────────

describe('initPreviewPanel — setPage()', () => {
  it('setPage(null) disables the button', () => {
    const { btnPreview } = buildPreviewDOM();
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');
    panel.setPage(null);
    expect(btnPreview.disabled).toBe(true);
  });

  it('setPage(path) does not start preview when panel is not active', async () => {
    buildPreviewDOM();
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchFn);
    const panel = initPreviewPanel();
    panel.setPage('index.qmd');

    // No preview/start call expected — panel is not active
    expect(fetchFn).not.toHaveBeenCalledWith(expect.stringContaining('/api/preview/start'), expect.anything());
  });
});
