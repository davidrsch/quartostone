// @vitest-environment happy-dom
/**
 * Unit tests for the panmirror visual editor module.
 *
 * Strategy:
 * - `pandocServer` methods are pure fetch wrappers; test each via a stubbed fetch.
 * - `createVisualEditor` loads a UMD bundle at runtime via a <script> tag.
 *   We short-circuit `loadPanmirror()` by pre-setting `window.Panmirror` to a
 *   mock before calling `createVisualEditor`.
 * - `buildEditorUIPrefs`, `buildEditorUI`, `buildEditorUIContext` etc. are
 *   pure functions; test their return shapes directly.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { pandocServer } from '../../../src/client/visual/pandocServer.js';
import {
  buildEditorUIPrefs,
  buildEditorDisplay,
  buildEditorUIContext,
  buildEditorDialogs,
  buildEditorUI,
} from '../../../src/client/visual/editorUI.js';
import { createVisualEditor } from '../../../src/client/visual/index.js';

// ── Fetch helper ──────────────────────────────────────────────────────────────

function stubFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Bad Request',
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── pandocServer ──────────────────────────────────────────────────────────────

describe('pandocServer', () => {
  describe('getCapabilities', () => {
    it('POSTs to /api/pandoc/capabilities and returns parsed JSON', async () => {
      const caps = { version: '3.1', api_version: [1, 23], output_formats: '', highlight_languages: '' };
      stubFetch(caps);

      const result = await pandocServer.getCapabilities();

      const [url, init] = (vi.mocked(fetch)).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/pandoc/capabilities');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({});
      expect(result).toEqual(caps);
    });

    it('throws on non-ok response', async () => {
      stubFetch({ error: 'pandoc unavailable' }, false, 503);
      await expect(pandocServer.getCapabilities()).rejects.toThrow('pandoc unavailable');
    });
  });

  describe('markdownToAst', () => {
    it('sends markdown, format, and options in request body', async () => {
      const ast = { blocks: [], 'pandoc-api-version': [1, 23], meta: {} };
      stubFetch(ast);

      const result = await pandocServer.markdownToAst('# Hello', 'markdown', ['+smart']);

      const [url, init] = (vi.mocked(fetch)).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/pandoc/markdownToAst');
      expect(JSON.parse(init.body as string)).toEqual({
        markdown: '# Hello',
        format: 'markdown',
        options: ['+smart'],
      });
      expect(result).toEqual(ast);
    });
  });

  describe('astToMarkdown', () => {
    it('sends ast, format, and options; returns string', async () => {
      stubFetch('# Hello\n');
      const ast = { blocks: [], 'pandoc-api-version': [1, 23], meta: {} };

      const result = await pandocServer.astToMarkdown(ast, 'markdown', ['+smart']);

      const [url, init] = (vi.mocked(fetch)).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/pandoc/astToMarkdown');
      expect(JSON.parse(init.body as string)).toEqual({ ast, format: 'markdown', options: ['+smart'] });
      expect(result).toBe('# Hello\n');
    });
  });

  describe('listExtensions', () => {
    it('POSTs format and returns string', async () => {
      stubFetch('+smart+raw_html');

      const result = await pandocServer.listExtensions('markdown');

      const [url, init] = (vi.mocked(fetch)).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/pandoc/listExtensions');
      expect(JSON.parse(init.body as string)).toEqual({ format: 'markdown' });
      expect(result).toBe('+smart+raw_html');
    });
  });

  describe('getBibliography', () => {
    it('sends all four params to the correct endpoint', async () => {
      const bibResult = { etag: 'e1', bibliography: { sources: [], project_biblios: [] } };
      stubFetch(bibResult);

      const result = await pandocServer.getBibliography('refs.bib', ['extra.bib'], null, 'e0');

      const [url, init] = (vi.mocked(fetch)).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/pandoc/getBibliography');
      expect(JSON.parse(init.body as string)).toEqual({
        file: 'refs.bib',
        bibliography: ['extra.bib'],
        refBlock: null,
        etag: 'e0',
      });
      expect(result).toEqual(bibResult);
    });
  });

  describe('addToBibliography', () => {
    it('sends all params to the correct endpoint', async () => {
      stubFetch(true);

      const result = await pandocServer.addToBibliography(
        'refs.bib', false, 'key1', '{"type":"article"}', '@article{key1}', '/project/doc.qmd',
      );

      const [url, init] = (vi.mocked(fetch)).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/pandoc/addToBibliography');
      expect(JSON.parse(init.body as string)).toMatchObject({ bibliography: 'refs.bib', id: 'key1' });
      expect(result).toBe(true);
    });
  });

  describe('citationHTML', () => {
    it('POSTs file, sourceAsJson, and csl', async () => {
      stubFetch('<span>Smith 2020</span>');

      const result = await pandocServer.citationHTML('doc.qmd', '{"type":"article"}', 'apa.csl');

      const [url, init] = (vi.mocked(fetch)).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/pandoc/citationHTML');
      expect(JSON.parse(init.body as string)).toEqual({
        file: 'doc.qmd',
        sourceAsJson: '{"type":"article"}',
        csl: 'apa.csl',
      });
      expect(result).toBe('<span>Smith 2020</span>');
    });
  });

  describe('stub sub-servers', () => {
    it('editorServer.doi.fetchCSL resolves to null without throwing', async () => {
      // Import editorServer directly to verify stubs
      const { editorServer } = await import('../../../src/client/visual/pandocServer.js');
      const result = await editorServer.doi.fetchCSL('10.1234/test');
      expect(result).toBeNull();
    });

    it('editorServer.xref.indexForFile resolves to empty refs when no server running', async () => {
      // The xrefServer now calls /api/xref/index — stub fetch to return empty
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ baseDir: '', refs: [] }),
      }));
      const { editorServer } = await import('../../../src/client/visual/pandocServer.js');
      const result = await editorServer.xref.indexForFile('/pages/doc.qmd');
      expect(result).toMatchObject({ refs: [] });
    });
  });
});

// ── editorUI helpers ──────────────────────────────────────────────────────────

describe('buildEditorUIPrefs', () => {
  it('returns correct default scalar values', () => {
    const prefs = buildEditorUIPrefs();

    expect(prefs.realtimeSpelling()).toBe(false);
    expect(prefs.tabKeyMoveFocus()).toBe(false);
    expect(prefs.packageListingEnabled()).toBe(false);
    expect(prefs.spacesForTab()).toBe(true);
    expect(prefs.tabWidth()).toBe(2);
    expect(prefs.autoClosingBrackets()).toBe(true);
    expect(prefs.zoteroUseBetterBibtex()).toBe(false);
    expect(prefs.equationPreview()).toBe(true);
  });

  it('emojiSkinTone defaults to 0, setEmojiSkinTone updates it', () => {
    const prefs = buildEditorUIPrefs();
    expect(prefs.emojiSkinTone()).toBe(0);
    prefs.setEmojiSkinTone(3);
    expect(prefs.emojiSkinTone()).toBe(3);
  });

  it('bibliographyDefaultType defaults to "bib", setter updates it', () => {
    const prefs = buildEditorUIPrefs();
    expect(prefs.bibliographyDefaultType()).toBe('bib');
    prefs.setBibliographyDefaultType('yaml');
    expect(prefs.bibliographyDefaultType()).toBe('yaml');
  });

  it('citationDefaultInText defaults to false, setter toggles it', () => {
    const prefs = buildEditorUIPrefs();
    expect(prefs.citationDefaultInText()).toBe(false);
    prefs.setCitationDefaultInText(true);
    expect(prefs.citationDefaultInText()).toBe(true);
  });

  it('listSpacing returns "spaced"', () => {
    const prefs = buildEditorUIPrefs();
    expect(prefs.listSpacing()).toBe('spaced');
  });
});

describe('buildEditorDisplay', () => {
  it('openURL calls window.open with noopener', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const display = buildEditorDisplay();
    display.openURL('https://example.com');
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
  });

  it('showContextMenu is undefined', () => {
    const display = buildEditorDisplay();
    expect(display.showContextMenu).toBeUndefined();
  });
});

describe('buildEditorUIContext', () => {
  it('getDocumentPath returns the supplied path', () => {
    const ctx = buildEditorUIContext('/pages/test.qmd');
    expect(ctx.getDocumentPath()).toBe('/pages/test.qmd');
  });

  it('getDocumentPath returns null when null supplied', () => {
    const ctx = buildEditorUIContext(null);
    expect(ctx.getDocumentPath()).toBeNull();
  });

  it('isWindowsDesktop returns false', () => {
    const ctx = buildEditorUIContext(null);
    expect(ctx.isWindowsDesktop()).toBe(false);
  });

  it('isActiveTab returns true', () => {
    const ctx = buildEditorUIContext(null);
    expect(ctx.isActiveTab()).toBe(true);
  });

  it('mapResourceToURL returns path unchanged', () => {
    const ctx = buildEditorUIContext(null);
    expect(ctx.mapResourceToURL('images/fig.png')).toBe('images/fig.png');
  });

  it('translateText returns text unchanged', () => {
    const ctx = buildEditorUIContext(null);
    expect(ctx.translateText('Hello')).toBe('Hello');
  });

  it('resolveImageUris returns same array', async () => {
    const ctx = buildEditorUIContext(null);
    const uris = ['img1.png', 'img2.png'];
    await expect(ctx.resolveImageUris(uris)).resolves.toEqual(uris);
  });
});

describe('buildEditorDialogs', () => {
  it('alert calls window.alert and returns true', async () => {
    const alertFn = vi.fn();
    vi.stubGlobal('alert', alertFn);
    const dialogs = buildEditorDialogs();
    const result = await dialogs.alert('Title', 'Message', 0);
    expect(alertFn).toHaveBeenCalledWith('Title\n\nMessage');
    expect(result).toBe(true);
  });

  it('editLink returns null (not implemented)', async () => {
    const dialogs = buildEditorDialogs();
    await expect(dialogs.editLink()).resolves.toBeNull();
  });

  it('htmlDialog returns false (always cancel)', async () => {
    const dialogs = buildEditorDialogs();
    const result = await dialogs.htmlDialog('T', null, undefined, () => { /* */ }, () => null);
    expect(result).toBe(false);
  });
});

describe('buildEditorUI', () => {
  it('returns an object with all required sub-sections', () => {
    const ui = buildEditorUI('/pages/doc.qmd');
    expect(ui).toHaveProperty('dialogs');
    expect(ui).toHaveProperty('display');
    expect(ui).toHaveProperty('context');
    expect(ui).toHaveProperty('prefs');
    expect(ui).toHaveProperty('images');
  });

  it('context.getDocumentPath reflects the supplied path', () => {
    const ui = buildEditorUI('/pages/hello.qmd');
    expect(ui.context.getDocumentPath()).toBe('/pages/hello.qmd');
  });
});

// ── createVisualEditor ────────────────────────────────────────────────────────

describe('createVisualEditor', () => {
  // Build a minimal mock of window.Panmirror.Editor
  type UpdateCallback = () => void;
  interface MockEditorInstance {
    setMarkdown: ReturnType<typeof vi.fn>;
    getMarkdown: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    _fireUpdate: () => void;
  }

  function buildMockEditor(): MockEditorInstance {
    let updateCb: UpdateCallback | null = null;
    const unsubscribe = vi.fn();
    return {
      setMarkdown: vi.fn().mockResolvedValue(undefined),
      getMarkdown: vi.fn().mockResolvedValue({ code: '# Hello\n' }),
      subscribe: vi.fn().mockImplementation((_event: string, cb: UpdateCallback) => {
        updateCb = cb;
        return unsubscribe;
      }),
      destroy: vi.fn(),
      _fireUpdate: () => updateCb?.(),
    };
  }

  let mockEditorInstance: MockEditorInstance;

  beforeEach(() => {
    mockEditorInstance = buildMockEditor();

    vi.stubGlobal('Panmirror', {
      Editor: {
        create: vi.fn().mockResolvedValue(mockEditorInstance),
      },
      UITools: {},
    });
  });

  it('calls Editor.create with a container element', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    await createVisualEditor({ container, initialMarkdown: '# Hello\n' });

    expect(window.Panmirror!.Editor.create).toHaveBeenCalledWith(
      container,
      expect.any(Object), // context
      expect.any(Object), // format
      expect.any(Object), // options
    );
  });

  it('calls setMarkdown with the initial markdown after creation', async () => {
    const container = document.createElement('div');
    await createVisualEditor({ container, initialMarkdown: '# Test\n' });

    expect(mockEditorInstance.setMarkdown).toHaveBeenCalledWith(
      '# Test\n',
      expect.any(Object), // writer options
      false,
    );
  });

  it('getMarkdown() returns the markdown from the underlying editor', async () => {
    const container = document.createElement('div');
    const instance = await createVisualEditor({ container, initialMarkdown: '' });

    const md = await instance.getMarkdown();
    expect(md).toBe('# Hello\n');
  });

  it('setMarkdown() proxies to the underlying editor setMarkdown', async () => {
    const container = document.createElement('div');
    const instance = await createVisualEditor({ container, initialMarkdown: '' });

    await instance.setMarkdown('## World\n');

    // Called once for initial load, once more for our call
    const calls = mockEditorInstance.setMarkdown.mock.calls;
    expect(calls[calls.length - 1][0]).toBe('## World\n');
  });

  it('onDirty callback is invoked when the editor fires an Update event', async () => {
    const container = document.createElement('div');
    const onDirty = vi.fn();

    await createVisualEditor({ container, initialMarkdown: '', onDirty });

    mockEditorInstance._fireUpdate();
    expect(onDirty).toHaveBeenCalledOnce();
  });

  it('destroy() calls editor.destroy() and unsubscribes', async () => {
    const container = document.createElement('div');
    const instance = await createVisualEditor({ container, initialMarkdown: '' });

    instance.destroy();

    expect(mockEditorInstance.destroy).toHaveBeenCalledOnce();
    // The subscribe mock returns a vi.fn() as the unsubscribe handle
    const unsubscribe = mockEditorInstance.subscribe.mock.results[0].value as ReturnType<typeof vi.fn>;
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('getMarkdown() returns empty string when result.code is undefined', async () => {
    mockEditorInstance.getMarkdown.mockResolvedValue({});
    const container = document.createElement('div');
    const instance = await createVisualEditor({ container, initialMarkdown: '' });
    await expect(instance.getMarkdown()).resolves.toBe('');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });
});
