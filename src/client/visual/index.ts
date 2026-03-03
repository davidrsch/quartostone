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
          // Use ProseMirror's coordsAtPos for accurate caret-based positioning
          const coords = view.coordsAtPos(view.state.selection.from);
          const anchor = document.createElement('span');
          anchor.style.position = 'fixed';
          anchor.style.left = `${coords.left}px`;
          anchor.style.top = `${coords.bottom}px`;
          anchor.style.pointerEvents = 'none';
          document.body.appendChild(anchor);
          const menu = buildSlashMenu(editor, dom as HTMLElement);
          // Reposition the menu to where the anchor is
          menu.style.left = `${coords.left}px`;
          menu.style.top = `${coords.bottom + 4}px`;
          anchor.remove();
          void menu; // already appended by buildSlashMenu
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
  /** Replace the entire editor content with parsed markdown. */
  setMarkdown(md: string): void;
  destroy(): void;
}

/**
 * Pre-process Quarto-style ::: {.callout-*} fences into HTML divs that the
 * ProseMirror markdown parser can map to quartoCallout nodes via parseHTML().
 *
 * Only single-level callouts are handled (no nesting). The title line
 * ("## Title") immediately after the opening fence is extracted as the
 * title attribute.
 */
function preprocessCallouts(md: string): string {
  const OPEN_RE = /^::: \{?\.callout-(\w+)(?:\})?\s*$/;
  const CLOSE_RE = /^:::$/;
  const lines = md.split('\n');
  const out: string[] = [];
  let inCallout: { type: string; title: string } | null = null;

  for (const line of lines) {
    if (!inCallout) {
      const m = OPEN_RE.exec(line.trim());
      if (m) {
        inCallout = { type: m[1], title: '' };
        // Don't emit yet — wait to see if next line is a title
        out.push(`<div data-callout="${inCallout.type}" class="callout callout-${inCallout.type}">`);
      } else {
        out.push(line);
      }
    } else {
      const titleMatch = /^##\s+(.+)/.exec(line);
      if (!inCallout.title && titleMatch) {
        inCallout.title = titleMatch[1];
        out.push(`<div class="callout-title">${inCallout.title}</div>`);
        out.push('<div class="callout-body">');
      } else if (CLOSE_RE.test(line.trim())) {
        if (!inCallout.title) {
          // No title found — still wrap body
          out.push('<div class="callout-body">');
        }
        out.push('</div></div>');
        inCallout = null;
      } else {
        if (!inCallout.title) {
          // First content line without a ## title
          inCallout.title = '_content_'; // sentinel
          out.push('<div class="callout-body">');
        }
        out.push(line);
      }
    }
  }

  if (inCallout) out.push('</div></div>'); // unclosed callout
  return out.join('\n');
}

// Parse markdown into ProseMirror doc using prosemirror-markdown default parser.
// The default parser handles most CommonMark constructs.
function parseMarkdown(md: string, editor: Editor): import('@tiptap/pm/model').Node {
  try {
    // Pre-process Quarto-specific syntax that prosemirror-markdown doesn't know about
    const processed = preprocessCallouts(md);
    return defaultMarkdownParser.parse(processed) ?? editor.schema.topNodeType.createAndFill()!;
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
    setMarkdown(md: string) {
      const doc = parseMarkdown(md, editor);
      editor.commands.setContent(doc.toJSON());
    },
    destroy() {
      editor.destroy();
    },
  };
}
