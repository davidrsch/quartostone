// src/client/visual/index.ts
// Panmirror-based WYSIWYG visual editor for .qmd files.
// Loads the pre-built panmirror UMD bundle (/panmirror.js), then instantiates
// an Editor with our PandocServer proxy and EditorUI stubs.

import { editorServer } from './pandocServer.js';
import { buildEditorUI } from './editorUI.js';

// ── Global type declaration for the UMD bundle ────────────────────────────────

declare global {
  interface Window {
    Panmirror?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Editor: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      UITools: any;
    };
  }
}

// ── Script loader ─────────────────────────────────────────────────────────────

let _panmirrorLoadPromise: Promise<void> | null = null;

function loadPanmirror(): Promise<void> {
  if (window.Panmirror) return Promise.resolve();
  if (_panmirrorLoadPromise) return _panmirrorLoadPromise;

  _panmirrorLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/panmirror.js';
    script.async = true;
    script.onload = () => {
      if (window.Panmirror) {
        resolve();
      } else {
        reject(new Error('panmirror.js loaded but window.Panmirror is undefined'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load /panmirror.js'));
    document.head.appendChild(script);
  });

  return _panmirrorLoadPromise;
}

// ── Exported interface ────────────────────────────────────────────────────────

export interface VisualEditorOptions {
  container: HTMLElement;
  initialMarkdown: string;
  /** Called whenever the document is modified */
  onDirty?: () => void;
  /** Path of the document being edited (for resource resolution) */
  documentPath?: string | null;
}

export interface VisualEditorInstance {
  /** Get the current document as markdown */
  getMarkdown(): Promise<string>;
  /** Replace the entire editor content */
  setMarkdown(md: string): Promise<void>;
  /** Destroy the editor and free resources */
  destroy(): void;
}

// ── Default pandoc writer options ─────────────────────────────────────────────

const PANDOC_WRITER_OPTIONS = {
  atxHeaders: true,
  wrap: 'none',
};

// ── Create the visual editor ──────────────────────────────────────────────────

export async function createVisualEditor(
  opts: VisualEditorOptions,
): Promise<VisualEditorInstance> {
  await loadPanmirror();

  const PanmirrorEditor = window.Panmirror!.Editor;

  const context = {
    server: editorServer,
    ui: buildEditorUI(opts.documentPath ?? null),
  };

  const format = {
    pandocMode: 'markdown',
    pandocExtensions: '+smart',
    rmdExtensions: {
      codeChunks: false,
      bookdownXRef: false,
      bookdownXRefUI: false,
      bookdownPart: false,
      blogdownMathInCode: false,
    },
    hugoExtensions: { shortcodes: false },
    docTypes: ['quarto'],
  };

  const options = {
    autoFocus: true,
    browserSpellCheck: false,
    outerScrollContainer: false,
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  const editor = await PanmirrorEditor.create(
    opts.container,
    context,
    format,
    options,
  );

  // Subscribe to document updates
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const unsubscribe: () => void = editor.subscribe('Update', () => {
    opts.onDirty?.();
  });

  // Load initial content
  await editor.setMarkdown(opts.initialMarkdown, PANDOC_WRITER_OPTIONS, false);

  return {
    async getMarkdown(): Promise<string> {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = await editor.getMarkdown(PANDOC_WRITER_OPTIONS);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      return (result.code as string) ?? '';
    },

    async setMarkdown(md: string): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await editor.setMarkdown(md, PANDOC_WRITER_OPTIONS, false);
    },

    destroy(): void {
      unsubscribe();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      editor.destroy();
    },
  };
}
