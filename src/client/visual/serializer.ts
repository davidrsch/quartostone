// src/client/visual/serializer.ts
// Converts a Tiptap/ProseMirror document to Quarto Markdown (.qmd).
// Uses prosemirror-markdown as the foundation and adds custom Quarto nodes.

import type { Node, Mark } from '@tiptap/pm/model';
import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeMarkdown(str: string): string {
  return str.replace(/[\\`*_{}<>()#+\-!|[\]]/g, '\\$&');
}

// Serialize text including marks (bold, italic, code, link)
function markText(node: Node, marks: Mark[]): string {
  let out = node.text ?? '';
  // Escape backslashes for raw text
  for (const mark of marks) {
    if (mark.type.name === 'bold') {
      out = `**${out}**`;
    } else if (mark.type.name === 'italic') {
      out = `_${out}_`;
    } else if (mark.type.name === 'code') {
      out = `\`${out}\``;
    } else if (mark.type.name === 'link') {
      out = `[${out}](${mark.attrs.href as string})`;
    } else if (mark.type.name === 'strike') {
      out = `~~${out}~~`;
    }
  }
  return out;
}

// ─── Main serializer ──────────────────────────────────────────────────────────

// We extend prosemirror-markdown's default serializer with Quarto-specific nodes.
// prosemirror-markdown only knows about standard Markdown nodes; custom nodes
// (quartoCallout, quartoCodeCell) need their own serialization rules.

export const quartoMarkdownSerializer = new MarkdownSerializer(
  {
    // ── Standard nodes (delegates to pm-markdown defaults) ─────────────────
    ...defaultMarkdownSerializer.nodes,

    // ── Override code_block to emit Quarto-style fences ──────────────────
    code_block(state, node) {
      const lang = (node.attrs.language as string | null) ?? '';
      state.write('```' + lang + '\n');
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write('```');
      state.closeBlock(node);
    },

    // ── Quarto callout ────────────────────────────────────────────────────
    quartoCallout(state, node) {
      const type = (node.attrs.calloutType as string) ?? 'note';
      const title = (node.attrs.title as string) ?? '';
      state.write(`::: {.callout-${type}}\n`);
      if (title) state.write(`## ${title}\n`);
      state.renderContent(node);
      state.write(':::');
      state.closeBlock(node);
    },

    // ── Quarto code cell ──────────────────────────────────────────────────
    quartoCodeCell(state, node) {
      const lang = (node.attrs.language as string) ?? 'python';
      const label = node.attrs.label as string | null;
      const echo = node.attrs.echo as boolean | null;

      const opts: string[] = [];
      if (label) opts.push(`#| label: ${label}`);
      if (echo === false) opts.push('#| echo: false');

      state.write('```{' + lang + '}\n');
      if (opts.length) state.write(opts.join('\n') + '\n');
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write('```');
      state.closeBlock(node);
    },

    // ── Table ─────────────────────────────────────────────────────────────
    table(state, node) {
      // Collect rows
      const rows: string[][] = [];
      node.forEach(rowNode => {
        const cells: string[] = [];
        rowNode.forEach(cellNode => {
          cells.push(cellNode.textContent.replace(/\|/g, '\\|'));
        });
        rows.push(cells);
      });
      if (!rows.length) return;

      const cols = Math.max(...rows.map(r => r.length));
      const padded = rows.map(r => {
        while (r.length < cols) r.push('');
        return r;
      });

      // Column widths
      const widths = Array.from({ length: cols }, (_, ci) =>
        Math.max(3, ...padded.map(r => r[ci]?.length ?? 0)),
      );

      const formatRow = (row: string[]) =>
        '| ' + row.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';

      const separator = '| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |';

      state.write(formatRow(padded[0]) + '\n');
      state.write(separator + '\n');
      for (let i = 1; i < padded.length; i++) {
        state.write(formatRow(padded[i]) + '\n');
      }
      state.write('\n');
    },

    // Suppress table_row / table_cell / table_header — handled by table above
    table_row() { /* noop */ },
    table_cell() { /* noop */ },
    table_header() { /* noop */ },
  },
  {
    ...defaultMarkdownSerializer.marks,
  },
);

// ─── Convenience wrapper ──────────────────────────────────────────────────────

/** Serialize a Tiptap editor doc to Quarto Markdown. */
export function docToMarkdown(doc: Node): string {
  return quartoMarkdownSerializer.serialize(doc);
}

export { escapeMarkdown, markText };
