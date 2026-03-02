// src/client/visual/runExtension.ts
// Tiptap Node extension that replaces StarterKit's codeBlock with a NodeView
// that renders an executable ▶ Run button for Quarto code cells ({python}, {r}, {julia}).
// Non-executable code blocks (```python, ```bash, etc.) are rendered identically
// but without a run button.

import { Node, mergeAttributes } from '@tiptap/core';

// ─── Executable language detection ───────────────────────────────────────────

// Matches Quarto-style executable fence languages: {python}, {r}, {julia}, {python3}
const EXEC_FENCE_RE = /^\{(python|python3|r|julia)\}$/i;

function execLang(language: string | null): string | null {
  if (!language) return null;
  const m = EXEC_FENCE_RE.exec(language.trim());
  return m ? m[1].toLowerCase() : null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── API call ─────────────────────────────────────────────────────────────────

async function runCode(
  code: string,
  language: string,
  outputEl: HTMLDivElement,
): Promise<void> {
  outputEl.style.display = '';
  outputEl.innerHTML = '<span class="cm-output-loading">Running…</span>';

  try {
    const res = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language }),
    });

    if (!res.ok) {
      const err = await res.json() as { error?: string };
      outputEl.innerHTML =
        `<pre class="cm-output-stderr">${escHtml(err.error ?? 'Execution failed')}</pre>`;
      return;
    }

    const result = await res.json() as {
      stdout: string;
      stderr: string;
      timedOut: boolean;
    };

    outputEl.innerHTML = '';

    if (result.timedOut) {
      outputEl.innerHTML =
        '<span class="cm-output-error">⚠ Execution timed out (30 s)</span>';
      return;
    }

    if (result.stdout) {
      const pre = document.createElement('pre');
      pre.className = 'cm-output-stdout';
      pre.textContent = result.stdout;
      outputEl.appendChild(pre);
    }

    if (result.stderr) {
      const pre = document.createElement('pre');
      pre.className = 'cm-output-stderr';
      pre.textContent = result.stderr;
      outputEl.appendChild(pre);
    }

    if (!result.stdout && !result.stderr) {
      outputEl.innerHTML =
        '<span class="cm-output-empty">No output</span>';
    }
  } catch {
    outputEl.innerHTML =
      '<span class="cm-output-error">Network error — could not reach the Quartostone server.</span>';
  }
}

// ─── Tiptap Node extension ────────────────────────────────────────────────────

/**
 * Replaces StarterKit's `codeBlock` node with an identical schema but
 * augmented with a NodeView that renders a ▶ Run button for executable
 * Quarto code cells (``` {python} / {r} / {julia} ``` fences).
 *
 * Enable by passing `StarterKit.configure({ codeBlock: false })` and
 * appending `VisualRunCodeBlock` to the extensions list.
 */
export const VisualRunCodeBlock = Node.create({
  name: 'codeBlock',
  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,

  addAttributes() {
    return {
      language: {
        default: null,
        parseHTML: element =>
          element.getAttribute('data-language') ??
          element.querySelector('code')?.className.replace(/^language-/, '') ??
          null,
        renderHTML: attrs =>
          attrs.language
            ? { 'data-language': attrs.language as string }
            : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const lang = node.attrs.language as string | null;
    return [
      'pre',
      mergeAttributes(HTMLAttributes, lang ? { 'data-language': lang } : {}),
      ['code', { class: lang ? `language-${lang}` : '' }, 0],
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Tab inserts two spaces inside code blocks
      Tab: ({ editor }) => {
        if (!editor.isActive('codeBlock')) return false;
        editor.commands.insertContent('  ');
        return true;
      },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const lang = node.attrs.language as string | null;
      const runLang = execLang(lang);

      // ── Outer wrapper ────────────────────────────────────────────────────
      const wrap = document.createElement('div');
      wrap.className = 'visual-code-block';

      // ── Pre / code (contentDOM) ──────────────────────────────────────────
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (lang) code.className = `language-${lang}`;
      pre.appendChild(code);
      wrap.appendChild(pre);

      // ── Run toolbar (only for executable cells) ──────────────────────────
      let outputEl: HTMLDivElement | null = null;
      let lastCode: string | null = null;   // tracks what was last run

      if (runLang) {
        const toolbar = document.createElement('div');
        toolbar.className = 'visual-code-toolbar';

        const btn = document.createElement('button');
        btn.textContent = '▶ Run';
        btn.className = 'cm-run-btn';
        btn.title = `Run ${runLang} cell`;
        toolbar.appendChild(btn);
        wrap.appendChild(toolbar);

        outputEl = document.createElement('div');
        outputEl.className = 'cm-cell-output';
        outputEl.style.display = 'none';
        wrap.appendChild(outputEl);

        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          // Get current code from editor state (node ref may be stale)
          const rawPos = typeof getPos === 'function' ? getPos() : undefined;
          const currentNode = rawPos !== undefined ? editor.state.doc.nodeAt(rawPos) : null;
          const currentCode = currentNode?.textContent ?? node.textContent;
          lastCode = currentCode;
          void runCode(currentCode, runLang, outputEl!);
        });
      }

      return {
        dom: wrap,
        contentDOM: code,

        update(updatedNode) {
          if (updatedNode.type.name !== 'codeBlock') return false;

          // If the code changed since last run, hide stale output
          if (outputEl && lastCode !== null) {
            const newCode = updatedNode.textContent;
            if (newCode !== lastCode) {
              outputEl.style.display = 'none';
              outputEl.innerHTML = '';
              lastCode = null;
            }
          }

          // Update language class
          const newLang = updatedNode.attrs.language as string | null;
          code.className = newLang ? `language-${newLang}` : '';
          return true;
        },
      };
    };
  },
});
