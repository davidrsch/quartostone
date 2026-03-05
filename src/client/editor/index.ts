// src/client/editor/index.ts
// CodeMirror 6 source-mode editor — Phase 1 baseline editor

import { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, ViewPlugin, Decoration } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { autocompletion } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { runCellExtension } from './runWidget.js';

const AUTOSAVE_DEBOUNCE_MS = 1_000; // debounce delay before auto-saving after last keystroke

// ── Image drag-drop upload (#96) ──────────────────────────────────────────────

/** Uploads a File to /api/assets and returns the URL, or null on failure. */
async function uploadImageFile(file: File): Promise<string | null> {
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    const res = await fetch('/api/assets', { method: 'POST', body: form });
    if (!res.ok) return null;
    const data = (await res.json()) as { url: string };
    return data.url;
  } catch {
    return null;
  }
}

/** CodeMirror extension: handle drop / paste of image files → upload + insert markdown */
function imageDragDropExtension(): Extension {
  return EditorView.domEventHandlers({
    dragover(event) {
      const types = event.dataTransfer?.types ?? [];
      if ([...types].includes('Files')) {
        event.preventDefault(); // allow drop
      }
    },
    drop(event, view) {
      const files = [...(event.dataTransfer?.files ?? [])].filter(f => f.type.startsWith('image/'));
      if (files.length === 0) return;
      event.preventDefault();
      // Determine drop position in document
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
      const insertAt = pos ?? view.state.doc.length;
      void (async () => {
        let at = insertAt;
        for (const file of files) {
          const url = await uploadImageFile(file);
          if (!url) continue;
          const alt = file.name.replace(/\.[^.]+$/, '');
          const md  = `![${alt}](${url})`;
          view.dispatch({
            changes: { from: at, insert: md },
            selection: { anchor: at + md.length },
          });
          at += md.length;
        }
      })();
    },
    paste(event, view) {
      const items = [...(event.clipboardData?.items ?? [])];
      const imageItems = items.filter(i => i.type.startsWith('image/'));
      if (imageItems.length === 0) return;
      event.preventDefault();
      const insertAt = view.state.selection.main.from;
      void (async () => {
        let offset = 0;
        for (const item of imageItems) {
          const file = item.getAsFile();
          if (!file) continue;
          try {
            const url = await uploadImageFile(file);
            if (!url) continue;
            const alt = 'image';
            const md  = `![${alt}](${url})`;
            view.dispatch({
              changes: { from: insertAt + offset, insert: md },
              selection: { anchor: insertAt + offset + md.length },
            });
            offset += md.length;
          } catch { /* ignore failed upload */ }
        }
      })();
    },
  });
}

export interface EditorOptions {
  container: HTMLElement;
  pagePath: string;
  onSave?: (content: string) => void;
  onSaveError?: (err: Error) => void;
  onDirty?: () => void;
}

/** @internal exported for unit tests */
export async function loadPage(path: string): Promise<string> {
  const res = await fetch(`/api/pages/${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`Failed to load page: ${path}`);
  const data = (await res.json()) as { content: string };
  return data.content;
}

/** @internal exported for unit tests */
export async function savePage(path: string, content: string): Promise<void> {
  const res = await fetch(`/api/pages/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to save page: ${path}`);
}

// ── Wiki link highlight decoration ───────────────────────────────────────────

const wikiLinkMark = Decoration.mark({ class: 'cm-wiki-link' });

const wikiLinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<typeof wikiLinkMark>();
      const re = /\[\[[^\]]+\]\]/g;
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.sliceDoc(from, to);
        let m: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) {
          builder.add(from + m.index, from + m.index + m[0].length, wikiLinkMark);
        }
      }
      return builder.finish();
    }
  },
  { decorations: v => v.decorations },
);

// ── [[ autocomplete ───────────────────────────────────────────────────────────

interface PageHit { path: string; title: string; }

async function wikiLinkCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  const match = context.matchBefore(/\[\[[^\]]*/);
  if (!match) return null;
  const typedAfterBrackets = match.text.slice(2); // text after [[
  try {
    const res = await fetch(`/api/links/search?q=${encodeURIComponent(typedAfterBrackets)}`);
    if (!res.ok) return null;
    const pages = await res.json() as PageHit[];
    return {
      from:    match.from + 2,  // replace text after [[
      options: pages.map(p => ({
        label:   p.title,
        detail:  p.path,
        apply:   p.title + ']]',
      })),
      validFor: /^[^\]]*$/,
    };
  } catch {
    return null;
  }
}

const wikiLinkTheme = EditorView.baseTheme({
  '.cm-wiki-link': {
    color: '#a78bfa',
    borderRadius: '2px',
    textDecoration: 'underline dotted',
  },
});

export async function createEditor(opts: EditorOptions): Promise<EditorView> {
  const initialContent = await loadPage(opts.pagePath);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const autoSave = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    opts.onDirty?.();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const content = update.state.doc.toString();
      savePage(opts.pagePath, content)
        .then(() => opts.onSave?.(content))
        .catch((err: unknown) => opts.onSaveError?.(err instanceof Error ? err : new Error(String(err))));
    }, AUTOSAVE_DEBOUNCE_MS);
  });

  const saveOnCtrlS: Extension = keymap.of([
    {
      key: 'Mod-s',
      run: (view) => {
        if (saveTimer) clearTimeout(saveTimer);
        const content = view.state.doc.toString();
        savePage(opts.pagePath, content)
          .then(() => opts.onSave?.(content))
          .catch((err: unknown) => { opts.onSaveError?.(err instanceof Error ? err : new Error(String(err))); });
        return true;
      },
    },
  ]);

  const darkTheme = EditorView.theme({
    '&': { height: '100%', background: '#1e1e1e', color: '#d4d4d4' },
    '.cm-scroller': { overflow: 'auto', padding: '16px 24px' },
    '.cm-cursor': { borderLeftColor: '#aeafad' },
    '.cm-selectionBackground, ::selection': { background: '#264f78 !important' },
    '.cm-gutters': { background: '#1e1e1e', borderRight: '1px solid #3e3e42' },
    '.cm-activeLineGutter': { background: '#282828' },
    '.cm-activeLine': { background: '#282828' },
  }, { dark: true });

  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      saveOnCtrlS,
      autoSave,
      EditorView.lineWrapping,
      markdown({ codeLanguages: languages }),
      wikiLinkPlugin,
      wikiLinkTheme,
      autocompletion({ override: [wikiLinkCompletions] }),
      darkTheme,
      imageDragDropExtension(),
      ...runCellExtension,
    ],
  });

  return new EditorView({ state, parent: opts.container });
}

// Live-reload via WebSocket — passes event name + data to callback
export function connectLiveReload(onEvent: (event: string, data: unknown) => void) {
  function connect() {
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);
    ws.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data as string) as { event: string; data?: unknown };
        onEvent(payload.event, payload.data);
      } catch {
        // silently ignore malformed messages
      }
    };
    ws.onclose = () => setTimeout(connect, 2000);
  }
  connect();
}

