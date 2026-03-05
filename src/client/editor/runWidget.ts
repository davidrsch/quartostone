// src/client/editor/runWidget.ts
// CodeMirror 6 extension — "Run" button on executable code blocks
// Supports {python}, {r} / {R}, {julia} fence markers

import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder, StateField, StateEffect, type Transaction } from '@codemirror/state';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CodeBlock {
  from: number;          // position of ```{lang} line (start of that line)
  to: number;            // position just after closing ``` line
  lang: string;          // 'python' | 'r' | 'julia'
  code: string;          // code content (without fence lines)
  openLineEnd: number;   // end of opening fence line (for widget placement)
  closeLineStart: number; // start of closing fence line
}

// ── State effect for execution output ─────────────────────────────────────────

interface OutputData {
  blockFrom: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  loading: boolean;
}

const setOutput = StateEffect.define<OutputData>();

const outputField = StateField.define<Map<number, OutputData>>({
  create: () => new Map(),
  update(outputs, tr) {
    const next = new Map(outputs);
    for (const effect of tr.effects) {
      if (effect.is(setOutput)) {
        next.set(effect.value.blockFrom, effect.value);
      }
    }
    // Remap positions when document changes
    if (tr.docChanged) {
      const remapped = new Map<number, OutputData>();
      for (const [pos, data] of next) {
        const newPos = tr.changes.mapPos(pos);
        remapped.set(newPos, { ...data, blockFrom: newPos });
      }
      return remapped;
    }
    return next;
  },
});

// ── Block parser ───────────────────────────────────────────────────────────────

const EXEC_LANGS = new Set(['python', 'python3', 'r', 'julia']);
const FENCE_OPEN = /^```\{(\w+)[\w\s,=#|"']*\}/;
const FENCE_CLOSE = /^```\s*$/;

function parseCodeBlocks(docText: string): CodeBlock[] {
  const lines = docText.split('\n');
  const blocks: CodeBlock[] = [];
  let pos = 0;
  let inBlock: { from: number; lang: string; openLineEnd: number; codeLines: string[] } | null = null;

  for (const line of lines) {
    const lineEnd = pos + line.length;
    if (!inBlock) {
      const m = FENCE_OPEN.exec(line);
      if (m) {
        const lang = m[1]!.toLowerCase();
        if (EXEC_LANGS.has(lang)) {
          inBlock = { from: pos, lang, openLineEnd: lineEnd, codeLines: [] };
        }
      }
    } else {
      if (FENCE_CLOSE.test(line)) {
        blocks.push({
          from: inBlock.from,
          to: lineEnd,
          lang: inBlock.lang,
          code: inBlock.codeLines.join('\n'),
          openLineEnd: inBlock.openLineEnd,
          closeLineStart: pos,
        });
        inBlock = null;
      } else {
        inBlock.codeLines.push(line);
      }
    }
    pos = lineEnd + 1; // +1 for '\n'
  }

  return blocks;
}

// ── Run button widget ──────────────────────────────────────────────────────────

class RunButtonWidget extends WidgetType {
  constructor(
    private readonly block: CodeBlock,
    private readonly onRun: (block: CodeBlock) => void,
  ) { super(); }

  eq(other: RunButtonWidget) { return other.block.from === this.block.from; }

  toDOM() {
    const btn = document.createElement('button');
    btn.textContent = '▶ Run';
    btn.className = 'cm-run-btn';
    btn.title = `Run ${this.block.lang} cell`;
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      this.onRun(this.block);
    });
    return btn;
  }

  ignoreEvent() { return false; }
}

// ── Output widget ──────────────────────────────────────────────────────────────

class OutputWidget extends WidgetType {
  constructor(private readonly data: OutputData) { super(); }

  eq(other: OutputWidget) {
    return other.data.blockFrom === this.data.blockFrom
      && other.data.loading === this.data.loading
      && other.data.stdout === this.data.stdout
      && other.data.stderr === this.data.stderr;
  }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-cell-output';

    if (this.data.loading) {
      const loadingSpan = document.createElement('span');
      loadingSpan.className = 'cm-output-loading';
      loadingSpan.textContent = 'Running…';
      wrap.appendChild(loadingSpan);
      return wrap;
    }

    if (this.data.timedOut) {
      const timeoutSpan = document.createElement('span');
      timeoutSpan.className = 'cm-output-error';
      timeoutSpan.textContent = '⚠ Execution timed out (30s)';
      wrap.appendChild(timeoutSpan);
      return wrap;
    }

    if (this.data.stdout) {
      const pre = document.createElement('pre');
      pre.className = 'cm-output-stdout';
      pre.textContent = this.data.stdout;
      wrap.appendChild(pre);
    }

    if (this.data.stderr) {
      const pre = document.createElement('pre');
      pre.className = 'cm-output-stderr';
      pre.textContent = this.data.stderr;
      wrap.appendChild(pre);
    }

    if (!this.data.stdout && !this.data.stderr) {
      const emptySpan = document.createElement('span');
      emptySpan.className = 'cm-output-empty';
      emptySpan.textContent = 'No output';
      wrap.appendChild(emptySpan);
    }

    return wrap;
  }

  ignoreEvent() { return true; }
}

// ── ViewPlugin — builds decoration set ────────────────────────────────────────

function buildDecorations(
  view: EditorView,
  onRun: (block: CodeBlock) => void,
): DecorationSet {
  const doc = view.state.doc.toString();
  const blocks = parseCodeBlocks(doc);
  const outputs = view.state.field(outputField);
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of blocks) {
    // Run button as inline widget at end of opening fence line
    const btnDeco = Decoration.widget({
      widget: new RunButtonWidget(block, onRun),
      side: 1,
    });
    builder.add(block.openLineEnd, block.openLineEnd, btnDeco);

    // Output widget below the closing fence
    const outData = outputs.get(block.from);
    if (outData) {
      const outputDeco = Decoration.widget({
        widget: new OutputWidget(outData),
        side: 1,
        block: true,
      });
      builder.add(block.to, block.to, outputDeco);
    }
  }

  return builder.finish();
}

// ── Execute a block ────────────────────────────────────────────────────────────

async function executeBlock(view: EditorView, block: CodeBlock): Promise<void> {
  // Show loading state
  view.dispatch({
    effects: setOutput.of({
      blockFrom: block.from,
      stdout: '',
      stderr: '',
      timedOut: false,
      loading: true,
    }),
  });

  try {
    const res = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: block.code, language: block.lang }),
    });

    if (!res.ok) {
      const err = await res.json() as { error?: string };
      view.dispatch({
        effects: setOutput.of({
          blockFrom: block.from,
          stdout: '',
          stderr: err.error ?? 'Execution failed',
          timedOut: false,
          loading: false,
        }),
      });
      return;
    }

    const result = await res.json() as {
      stdout: string;
      stderr: string;
      timedOut: boolean;
    };

    view.dispatch({
      effects: setOutput.of({
        blockFrom: block.from,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        loading: false,
      }),
    });
  } catch {
    view.dispatch({
      effects: setOutput.of({
        blockFrom: block.from,
        stdout: '',
        stderr: 'Network error — could not reach the Quartostone server.',
        timedOut: false,
        loading: false,
      }),
    });
  }
}

// ── Extension export ──────────────────────────────────────────────────────────

export const runCellExtension = [
  outputField,
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, block => executeBlock(view, block));
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged
          || update.transactions.some((tr: Transaction) => tr.effects.some(e => e.is(setOutput)))
        ) {
          this.decorations = buildDecorations(update.view, block => executeBlock(update.view, block));
        }
      }
    },
    { decorations: v => v.decorations },
  ),
];
