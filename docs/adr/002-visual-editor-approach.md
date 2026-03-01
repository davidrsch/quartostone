# ADR 002: Visual Editor Approach — Tiptap over Panmirror Extraction

**Date**: 2025-07  
**Status**: Accepted  
**Closes**: Spike #14

---

## Context

Issue #14 asked us to study how `quarto-vscode` embeds panmirror (ProseMirror-based WYSIWYG editor) inside a VS Code webview, identify VS Code-specific APIs that need replacement, understand the message protocol, and determine whether panmirror can be bundled standalone.

PBI #24 requires a visual (WYSIWYG) editing mode for `.qmd` files.

---

## Research Findings

### Panmirror architecture in quarto-vscode

The terms "panmirror" and "visual editor" in the Quarto ecosystem refer to the ProseMirror-based rich text editor originally built by RStudio/Posit. It lives in versions of `quarto-vscode` that have `src/editor/` and `src/editor-server/` directories (a separate, older fork of the extension). Key findings from that codebase and the broader quarto ecosystem:

1. **VS Code coupling is deep.** The webview JavaScript calls `acquireVsCodeApi()` at the top of every entry point. This gives it `vscode.postMessage`, `vscode.getState`, `vscode.setState` — none of which exist in a plain browser context.

2. **IPC message protocol.** The editor communicates with the extension host through a typed message protocol (`EditorServerEvent` / `EditorClientEvent`). The host handles:
   - File I/O (read/write `.qmd` files via `vscode.workspace.fs`)
   - Citation lookup (calls Quarto's pandoc citation service)
   - Cross-reference resolution (figures, tables, sections)
   - Image upload (converts clipboard paste to project-relative file path)
   - Math preview (calls KaTeX / MathJax via the extension host)
   - Spell-checking via VS Code's API
   - Theme token injection via `vscode.ColorThemeKind`

3. **No standalone npm package.** The panmirror bundle is not published to npm as a standalone, importable, browser-ready library. It is compiled as part of the VS Code extension build pipeline (webpack) and uses VS Code-specific externals.

4. **Quarto-cli webui** (`src/webui/quarto-preview/`) is a Vite-built React + TypeScript app for the preview pane, not the editor. It does not contain the ProseMirror editor code.

5. **Adaptation cost estimate.** Replacing `acquireVsCodeApi()` with a fetch/WebSocket adapter would require:
   - An abstraction layer for all ~20 IPC message types
   - Local API endpoints for every IPC handler (citations, crossrefs, images, spell-check, math)
   - De-coupling from VS Code theme tokens (CSS variable remapping)
   - Removing webpack externals and rewriting the build pipeline

   Estimated effort: 3–5 engineer-weeks for a minimally functional extraction, with significant ongoing maintenance risk as panmirror is not designed for external embedding.

---

## Options Considered

### Option A: Extract and adapt panmirror from quarto-vscode

- **Pros**: Faithful to Quarto's own visual editing model; supports all Quarto-specific AST nodes (callouts, tabsets, code cells, crossrefs)
- **Cons**: Major extraction effort; tightly coupled to VS Code APIs; not publicly licensed as a reusable library; brittle to upstream updates

### Option B: Tiptap (ProseMirror-based) with custom Quarto extensions ✅ Chosen

- **Pros**: MIT-licensed; actively maintained; browser-native from the start; mature ecosystem of extensions; well-documented ProseMirror schema API; easy to bundle with Vite; can add Quarto-specific node types (callout, tabset, code-cell, crossref) as custom extensions
- **Cons**: Does not share code with Quarto's canonical visual editor; some Quarto-specific constructs need bespoke implementation; markdown round-trip serialization must be written

### Option C: CodeMirror-only (source mode, defer visual mode)

- **Pros**: Already implemented; zero extra dependencies
- **Cons**: No WYSIWYG; blocks PBI #24

### Option D: Simple `contenteditable` + Showdown/Marked

- **Pros**: Tiny; no dependencies
- **Cons**: Poor editing experience; no structured node support; extremely difficult to support Quarto-specific constructs

---

## Decision

**Use Tiptap 2 as the visual editor foundation.**

Tiptap is ProseMirror underneath, meaning the document model, transaction API, and extension primitives are identical to what panmirror uses. The approach:

1. **Tiptap starter kit** handles headings, bold, italic, lists, blockquote, code blocks, links, images.
2. **Custom Quarto extensions** (implemented as Tiptap `Node` or `Mark` extensions):
   - `QuartoCallout` — `:::` div fences with `{.callout-*}` class
   - `QuartoTabset` — `:::` div fences with `.panel-tabset`
   - `QuartoCodeCell` — fenced code blocks with `{lang}` and Quarto chunk options
   - `QuartoCrossref` — `@fig-`, `@tbl-`, `@sec-` inline references
3. **Markdown serializer**: use `prosemirror-markdown` + a custom serializer for Quarto nodes; this produces valid `.qmd` on demand without a round-trip through pandoc.
4. **Mode toggle**: the existing CodeMirror source editor (`src/client/editor/index.ts`) stays. A "Source / Visual" toggle in the toolbar switches between them; switching serializes/deserializes via the markdown serializer.

---

## Milestone

PBI #24 implementation plan (single PR):

| Task                                                    | Detail                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Add `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/pm` | devDependency                                               |
| `src/client/visual/index.ts`                            | `initVisualEditor(el, { getContent, setContent, onDirty })` |
| Custom extension: `QuartoCodeCell`                      | Renders as highlighted code block with language badge       |
| Custom extension: `QuartoCallout`                       | Renders collapsible colored callout box                     |
| Markdown serializer                                     | `src/client/visual/serializer.ts`                           |
| Mode toggle in `main.ts`                                | `#btn-mode-source` and `#btn-mode-visual` in toolbar        |

---

## Consequences

- Panmirror / quarto-vscode visual editor is **not** used; Quartostone Visual mode will not be bit-for-bit identical to RStudio's visual mode.
- Tiptap 2 is MIT-licensed and will be listed as a regular devDependency.
- The custom Quarto extensions are our responsibility to maintain.
- Cross-reference resolution (e.g. showing figure numbers) will be deferred to a later milestone since it requires pandoc AST access.
- Spell-check will use the browser's native `spellcheck` attribute initially.
