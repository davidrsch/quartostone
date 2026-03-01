// src/client/editor/index.ts
// CodeMirror 6 source-mode editor — Phase 1 baseline editor

import { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';

export interface EditorOptions {
  container: HTMLElement;
  pagePath: string;
  onSave?: (content: string) => void;
  onDirty?: () => void;
}

async function loadPage(path: string): Promise<string> {
  const res = await fetch(`/api/pages/${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`Failed to load page: ${path}`);
  const data = (await res.json()) as { content: string };
  return data.content;
}

async function savePage(path: string, content: string): Promise<void> {
  const res = await fetch(`/api/pages/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to save page: ${path}`);
}

export async function createEditor(opts: EditorOptions): Promise<EditorView> {
  const initialContent = await loadPage(opts.pagePath);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const autoSave = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    opts.onDirty?.();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const content = update.state.doc.toString();
      await savePage(opts.pagePath, content);
      opts.onSave?.(content);
    }, 1000);
  });

  const saveOnCtrlS: Extension = keymap.of([
    {
      key: 'Mod-s',
      run: (view) => {
        if (saveTimer) clearTimeout(saveTimer);
        const content = view.state.doc.toString();
        savePage(opts.pagePath, content).then(() => opts.onSave?.(content));
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
      darkTheme,
    ],
  });

  return new EditorView({ state, parent: opts.container });
}

// Live-reload via WebSocket — passes event name + data to callback
export function connectLiveReload(onEvent: (event: string, data: unknown) => void) {
  function connect() {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (msg) => {
      const payload = JSON.parse(msg.data as string) as { event: string; data?: unknown };
      onEvent(payload.event, payload.data);
    };
    ws.onclose = () => setTimeout(connect, 2000);
  }
  connect();
}

