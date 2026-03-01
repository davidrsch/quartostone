// src/client/editor/index.ts
// CodeMirror 6 source-mode editor — Phase 1 baseline editor

import { EditorState, Extension } from '@codemirror/state';
import { EditorView, keymap, lineWrapping } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';

export interface EditorOptions {
  container: HTMLElement;
  pagePath: string;
  onSave?: (content: string) => void;
}

async function loadPage(path: string): Promise<string> {
  const res = await fetch(`/api/pages/${path}`);
  if (!res.ok) throw new Error(`Failed to load page: ${path}`);
  const data = (await res.json()) as { content: string };
  return data.content;
}

async function savePage(path: string, content: string): Promise<void> {
  const res = await fetch(`/api/pages/${path}`, {
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

  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      saveOnCtrlS,
      autoSave,
      lineWrapping,
      markdown({ codeLanguages: languages }),
      EditorView.baseTheme({
        '&': { height: '100%', fontSize: '15px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ],
  });

  return new EditorView({ state, parent: opts.container });
}

// Live-reload via WebSocket
export function connectLiveReload(onReload: () => void) {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data as string) as { event: string };
    if (data.event === 'render:complete') onReload();
  };
  ws.onclose = () => setTimeout(() => connectLiveReload(onReload), 2000);
}
