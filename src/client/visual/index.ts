// src/client/visual/index.ts
// Tiptap-based WYSIWYG visual editor for .qmd files.
// Parses markdown to ProseMirror doc, renders WYSIWYG, serializes back to .qmd.

import { Editor, Extension, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { VisualRunCodeBlock } from './runExtension.js';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { defaultMarkdownParser } from 'prosemirror-markdown';
import { docToMarkdown } from './serializer.js';

// ─── Custom Quarto Callout extension ─────────────────────────────────────────

const QuartoCallout = Node.create({
  name: 'quartoCallout',
  group: 'block',
  content: 'block+',
  atom: false,

  addAttributes() {
    return {
      calloutType: { default: 'note' },
      title: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = (node.attrs.calloutType as string) ?? 'note';
    const title = (node.attrs.title as string) ?? '';
    return [
      'div',
      { ...HTMLAttributes, 'data-callout': type, class: `callout callout-${type}` },
      ['div', { class: 'callout-title' }, title || type.charAt(0).toUpperCase() + type.slice(1)],
      ['div', { class: 'callout-body' }, 0],
    ];
  },
});

// ─── Slash-command plugin ─────────────────────────────────────────────────────

type SlashItem = { label: string; description: string; action: (editor: Editor) => void };

function buildSlashMenu(editor: Editor, anchor: HTMLElement): HTMLElement {
  const items: SlashItem[] = [
    { label: 'Heading 1', description: 'Large section heading', action: e => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: 'Heading 2', description: 'Medium section heading', action: e => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Heading 3', description: 'Small section heading', action: e => e.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: 'Bullet list', description: 'Unordered list', action: e => e.chain().focus().toggleBulletList().run() },
    { label: 'Ordered list', description: 'Numbered list', action: e => e.chain().focus().toggleOrderedList().run() },
    { label: 'Code block', description: 'Fenced code block', action: e => e.chain().focus().toggleCodeBlock().run() },
    { label: 'Blockquote', description: 'Indented quote', action: e => e.chain().focus().toggleBlockquote().run() },
    { label: 'Table', description: '3×3 table', action: e => e.chain().focus().insertTable({ rows: 3, cols: 3 }).run() },
    { label: 'Note callout', description: 'Quarto ::: {.callout-note}', action: e => e.chain().focus().insertContent({ type: 'quartoCallout', attrs: { calloutType: 'note' }, content: [{ type: 'paragraph' }] }).run() },
    { label: 'Warning callout', description: 'Quarto ::: {.callout-warning}', action: e => e.chain().focus().insertContent({ type: 'quartoCallout', attrs: { calloutType: 'warning' }, content: [{ type: 'paragraph' }] }).run() },
    { label: 'Tip callout', description: 'Quarto ::: {.callout-tip}', action: e => e.chain().focus().insertContent({ type: 'quartoCallout', attrs: { calloutType: 'tip' }, content: [{ type: 'paragraph' }] }).run() },
    { label: 'Horizontal rule', description: '--- divider line', action: e => e.chain().focus().setHorizontalRule().run() },
  ];

  const menu = document.createElement('div');
  menu.className = 'slash-menu';
  menu.setAttribute('role', 'listbox');

  let selected = 0;

  function render(filterText: string) {
    menu.innerHTML = '';
    const filtered = items.filter(i =>
      i.label.toLowerCase().includes(filterText.toLowerCase()) ||
      i.description.toLowerCase().includes(filterText.toLowerCase()),
    );
    if (!filtered.length) {
      menu.style.display = 'none';
      return;
    }
    menu.style.display = '';
    filtered.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'slash-item' + (idx === selected ? ' selected' : '');
      el.setAttribute('role', 'option');
      el.innerHTML = `<strong>${item.label}</strong><span>${item.description}</span>`;
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        item.action(editor);
        removeMenu();
      });
      menu.appendChild(el);
    });
  }

  function removeMenu() {
    menu.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e: KeyboardEvent) {
    if (!menu.parentNode) return;
    const items2 = menu.querySelectorAll<HTMLDivElement>('.slash-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selected = Math.min(selected + 1, items2.length - 1);
      items2.forEach((el, i) => el.classList.toggle('selected', i === selected));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      items2.forEach((el, i) => el.classList.toggle('selected', i === selected));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items2[selected]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      removeMenu();
    }
  }

  document.addEventListener('keydown', onKey);

  // Position near anchor
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  document.body.appendChild(menu);

  render('');

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function handler() {
      removeMenu();
      document.removeEventListener('click', handler);
    });
  }, 0);

  return menu;
}

const slashCommandPluginKey = new PluginKey('slashCommand');

function makeSlashPlugin(editorRef: { current: Editor | null }): Plugin {
  return new Plugin({
    key: slashCommandPluginKey,
    props: {
      handleKeyDown(view, event) {
        if (event.key !== '/') return false;
        const editor = editorRef.current;
        if (!editor) return false;
        // Only trigger slash menu if at start of an empty paragraph
        const { $from } = view.state.selection;
        const isEmpty = $from.parent.textContent === '';
        if (!isEmpty) return false;

        // Allow the '/' char to be typed, then show menu
        setTimeout(() => {
          const { dom } = view;
          const caretEl = dom.ownerDocument.querySelector('.ProseMirror p:focus') as HTMLElement ??
            dom.querySelector<HTMLElement>('[data-slash-anchor]') ??
            dom;
          buildSlashMenu(editor, caretEl || dom as HTMLElement);
        }, 0);
        return false; // let the / be inserted normally
      },
    },
  });
}

// ─── Exported interface ───────────────────────────────────────────────────────

export interface VisualEditorOptions {
  container: HTMLElement;
  initialMarkdown: string;
  onDirty?: () => void;
}

export interface VisualEditorInstance {
  getMarkdown(): string;
  destroy(): void;
}

// Parse markdown into ProseMirror doc using prosemirror-markdown default parser.
// The default parser handles most CommonMark constructs.
function parseMarkdown(md: string, editor: Editor): import('@tiptap/pm/model').Node {
  try {
    return defaultMarkdownParser.parse(md) ?? editor.schema.topNodeType.createAndFill()!;
  } catch {
    // Fallback: wrap raw text in a paragraph
    return editor.schema.topNodeType.createAndFill(null, [
      editor.schema.nodes.paragraph.create(null, editor.schema.text(md)),
    ])!;
  }
}

export async function createVisualEditor(opts: VisualEditorOptions): Promise<VisualEditorInstance> {
  const editorRef: { current: Editor | null } = { current: null };

  const SlashCommandExtension = Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [makeSlashPlugin(editorRef)];
    },
  });

  const editor = new Editor({
    element: opts.container,
    extensions: [
      StarterKit.configure({
        // Replaced by VisualRunCodeBlock (adds ▶ Run button for executable cells)
        codeBlock: false,
      }),
      VisualRunCodeBlock,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({ inline: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Start writing… type '/' for commands" }),
      QuartoCallout,
      SlashCommandExtension,
    ],
    content: '',
    onUpdate({ editor: _ed }) {
      opts.onDirty?.();
    },
  });

  editorRef.current = editor;

  // Parse the initial markdown and load it
  const doc = parseMarkdown(opts.initialMarkdown, editor);
  editor.commands.setContent(doc.toJSON());

  return {
    getMarkdown() {
      return docToMarkdown(editor.state.doc);
    },
    destroy() {
      editor.destroy();
    },
  };
}
