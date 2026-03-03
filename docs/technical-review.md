# Quartostone — Honest Technical Review & Development Plan

> **Purpose**: This document is an unvarnished engineering autopsy of the current state, an analysis of why the test suite failed to surface real problems, and a substantive development plan. It is written to be read by anyone joining the project, not as a victory lap.

---

## 1. What Is Actually Broken (and Why)

### 1.1 Visual Editor — Fundamental Architecture Problem

The current visual editor uses **Tiptap + `prosemirror-markdown`'s `defaultMarkdownParser`**. This is wrong for Quarto documents for the following reasons:

| Problem | Detail |
|---------|--------|
| YAML frontmatter | `defaultMarkdownParser` has no frontmatter rule. The `---` delimiters get parsed as thematic breaks or throw. Content is lost or garbled on every load. |
| Quarto code cell attributes | `{python}`, `{r}`, `#\| echo: false` etc. are not CommonMark. They survive only as raw text inside a generic code block, stripping the language and options. |
| Math (`$`, `$$`) | Not in the CommonMark spec and not in `defaultMarkdownParser`. Dollar signs pass through as plain text; equations are destroyed. |
| Quarto callouts (`:::`) | Handled by a custom preprocessor, but it is fragile and does not cover nested callouts, `collapse=`, `appearance=`, or `icon=false` attributes. |
| Markdown serializer round-trip | `docToMarkdown` in `visual/serializer.ts` re-emits standard CommonMark. Any Quarto-specific attributes present in the original file are silently dropped on first save. |
| Tables | The Tiptap table extension round-trips correctly, but alignment (`| :--- |`) is lost because the serializer always emits unaligned pipes. |
| Raw HTML blocks | ProseMirror turns unknown HTML into a `html_block` node; the serializer currently emits them as-is, but only if the node type exists — it doesn't in this schema. |

**Net effect**: Switch to visual mode → content appears to load (the editor fills in) → switch back to source mode → the document has been silently mutated. Frontmatter stripped, code attributes gone, math broken. This is worse than not having a visual editor.

**Root cause of the confusion**: The switchMode path (`main.ts:161`) reads content from `activeView.state.doc.toString()` and passes it to `createVisualEditor({ initialMarkdown })`. The parser runs, silently drops what it doesn't understand, and the user never sees an error. The save path later reads `getMarkdown()` from the lossy round-trip. Because the UI renders the truncated content without complaint, it *looks* like it's working.

### 1.2 Preview — Structural Issues

| Problem | Detail |
|---------|--------|
| `quarto preview` process management | The server spawns `quarto preview <file>` as a child process and reads a port from stdout. The port-detection regex (`/http:\/\/localhost:(\d+)/`) works only for Quarto ≥1.3 output format. Earlier or later versions may differ. |
| iframe same-origin restriction | The preview iframe loads `http://localhost:<port>` which is a different origin from the app (`localhost:4242`). This is fine for display, but `postMessage` or `document.cookie` inside the iframe won't work. More critically, **hot-reload signals from the preview server cannot be forwarded to the app frame**. |
| No readiness check | The polling in `preview/index.ts` does `fetch(url)` up to 15 times. But `quarto preview` serves a WebSocket-injected page that returns 200 immediately even when the document is still rendering. The iframe shows a blank or partial page. |
| Quarto not on PATH | The most common failure: Quarto is installed but not on the system PATH used by `child_process.spawn`. On Windows especially this silently produces an ENOENT which is swallowed and displayed as "Preview failed". There is no diagnostic telling the user where Quarto is expected. |
| `RenderFormat` mismatch | `POST /api/preview/start` accepts `format` but passes it to `quarto preview` which does not accept a `--to` override in the same way `quarto render` does. The format is ignored. |

### 1.3 File Management — Missing Entirely

The sidebar renders a read-only tree. There is no:
- Create folder
- Rename file or folder
- Delete file or folder  
- Move file (drag-and-drop or cut/paste)
- Duplicate file
- Context menu (right-click)

The `+ New page` button creates a flat file but cannot insert it into a sub-folder path through the UI (you can type `subfolder/filename` but the dialog has no folder picker).

### 1.4 Application Design

Compared to VS Code or Positron:
- No **resizable sidebar** (fixed 260px)
- No **keyboard navigation** of the file tree (arrow keys, Enter to open)
- No **context menu** on any element
- No **tab bar** — only one file open at a time; switching loses unsaved changes
- No **split pane** editor (the preview split is the only one)
- Toolbar buttons have no **tooltips**
- No **command palette** (Ctrl+Shift+P shows a browser prompt, not a real command palette)
- No **status bar** click actions (the branch display is text-only)
- The **theme** is hard-coded dark; no light mode, no VS Code theme integration

### 1.5 Style/Dropdown Bugs Fixed by User

The user manually corrected CSS in `style.css` and `serve.ts`. The specific changes should be reviewed and committed properly. The dropdowns staying open was caused by click-outside handlers attaching to `document` with `{ once: true }` being added every time a dropdown opened, so rapid opens/closes would accumulate orphaned listeners. This is a classic event-listener leak.

---

## 2. Why the Test Suite Missed All of This

This is the more important question. The answer is: **the test suite was designed to verify API contracts, not application behavior**.

### 2.1 What the Tests Actually Test

```
tests/
  unit/server/          ← HTTP request → HTTP response, all deps mocked
  integration/server/   ← HTTP request → real filesystem (tmp dir), no browser
  e2e/editor.spec.ts    ← Playwright opens the app, but...
```

The E2E tests do things like:
```typescript
const res = await page.request.get('/api/preview/status');
expect(res.status()).toBe(200);
```

This is an **API test via the browser context**, not a UI test. It never opens a file, never interacts with the editor, never checks that content is visible.

The visual editor tests do:
```typescript
await page.click('#btn-mode-visual');
await expect(page.locator('.cm-editor')).toBeHidden();
```

This checks that the CodeMirror editor disappears. It does not check that the Tiptap editor appeared with the correct content.

### 2.2 The Testing Pyramid Is Inverted

| Layer | Tests we have | Tests we need |
|-------|--------------|---------------|
| Contract (API schema) | ✅ Thorough | Sufficient |
| Business logic (server) | ✅ Good | Sufficient |
| Component (client modules) | ❌ Zero | Critical |
| Integration (full page flow) | ❌ Zero | Critical |
| Visual regression | ⚠️ One baseline screenshot | Inadequate |

We have a strong base but no middle. Component and integration tests would have caught every single issue listed in Section 1.

### 2.3 Specific Gaps

| Issue | Test that would have caught it |
|-------|-------------------------------|
| YAML frontmatter lost in visual editor | Vitest unit test: `parseMarkdown(md)` → `docToMarkdown(doc)` should round-trip identical output |
| Visual editor shows blank content | E2E: open file with known content in visual mode, assert text is visible in `.tiptap` container |
| Quarto code block attributes stripped | Unit test: round-trip `.qmd` with `{python}` cell through `parseMarkdown → docToMarkdown` |
| Preview never shows content | E2E: `startPreview` → wait for iframe `src` to be set → `frame.url()` is not empty |
| Dropdown stays open on second click | Component test: dispatch click-outside event → menu element should not be in DOM |
| Save after visual-mode switch corrupts file | Integration test: load page, switch to visual, switch back, read file from disk — content must be byte-for-byte identical |

---

## 3. Development Plan

### Phase A — Stabilise the Visual Editor (4–6 weeks)

The current approach (prosemirror-markdown default parser) must be replaced. There are two viable options:

**Option A1 — Embed Monaco Editor (VS Code's editor engine)**  
Monaco is the same editor used in VS Code and Positron. It has first-class support for:
- Syntax highlighting for `.qmd` (which is essentially Markdown + R/Python code fences)
- Find/replace, multi-cursor, minimap, keybindings identical to VS Code
- Extensible language support via Language Server Protocol

Downsides: Monaco is ~3 MB (acceptable); WYSIWYG is not native (you get a very good source editor, not true visual editing).

**Option A2 — Quarto Visual Editor Protocol**  
Quarto's own visual editor (used in RStudio/Positron) is open source. It is built on ProseMirror but uses a custom schema and markdown parser written specifically for Quarto's dialect (`quarto-dev/quarto` repo, `packages/editor`). It handles frontmatter, math, callouts, code cells with cell options, and cross-references correctly.

This is the right long-term option but requires significant integration work: the editor runs as a separate iframe loaded from a locally served bundle, communicating via `postMessage`.

**Recommended short-term action**: Replace visual mode with Monaco. This gives users a powerful editor immediately. True WYSIWYG via the Quarto editor protocol is Phase B.

**Actions:**
1. Remove `@tiptap/*`, `prosemirror-markdown` from dependencies
2. Add `monaco-editor` or use `@monaco-editor/react` (since we're not React, use the vanilla API)
3. Replace `src/client/visual/index.ts` with a Monaco instance configured for `markdown` language
4. Register a custom `.qmd` language that extends Markdown with Quarto syntax tokens
5. Add a Quarto Language Server client for completion and diagnostics
6. Write round-trip tests for the serializer before removing old code

### Phase B — Fix Preview (1–2 weeks)

1. **Quarto PATH detection**: On startup, run `which quarto` / `where quarto` and store the absolute path. Surface diagnostic in the UI if not found.
2. **Port detection**: Parse the actual Quarto preview port from stdout with a timeout, not a regex guess.
3. **Readiness polling**: Poll the actual rendered HTML endpoint, not the iframe URL. Check that the response body contains rendered HTML (length > 500 bytes, contains `<html`).
4. **Reload signal forwarding**: Listen to the Quarto preview WebSocket → forward `rebuild` events to the app via the existing app WebSocket → the iframe reloads its `src` only then.
5. **Tests**: E2E test that mocks `quarto preview` output, verifies iframe `src` is set after readiness.

### Phase C — File Management (2–3 weeks)

1. **Server API**: Add `POST /api/pages/folder`, `PATCH /api/pages/:path` (rename/move), `DELETE /api/pages/:path`
2. **Context menu component**: Generic right-click menu triggered on tree items; actions: Open, Rename, Move to..., Duplicate, Delete
3. **Drag-and-drop**: HTML5 drag API on tree items; drop target highlights; calls PATCH to move
4. **Keyboard navigation**: `↑`/`↓` to move selection, `Enter` to open, `F2` to rename, `Delete` to delete (with confirmation), `→`/`←` to expand/collapse folders
5. **New page in folder**: The new-page dialog should have a folder picker (a `<select>` populated from the tree, or a path input with autocomplete)
6. **Tests**: All API endpoints unit-tested; E2E tests for rename, move, delete flows

### Phase D — Application UX Polish (3–4 weeks)

Priority order based on impact:

| Priority | Feature | Note |
|----------|---------|------|
| P1 | Resizable sidebar | CSS `resize` on sidebar or a manual drag handle |
| P1 | Tab bar (multi-file open) | Standard editor UX; prevents data-loss from unsaved-changes confirm |
| P1 | Tooltips on all toolbar buttons | `title` attribute is sufficient initially |
| P2 | Command palette (Ctrl+Shift+P) | Searchable list of all actions; replaces all keyboard shortcut dialogs |
| P2 | File tree keyboard navigation | See Phase C |
| P2 | Light/dark theme toggle | Allow the user to choose; respect `prefers-color-scheme` by default |
| P3 | Split editor pane | Two files side-by-side |
| P3 | Status bar click actions | Click branch name → branch picker; click render status → open preview |
| P3 | Breadcrumb nav | Show `pages/section/file.qmd` path with clickable segments |

### Phase E — Test Suite Overhaul (parallel with A–D)

This must run in parallel with development, not after it.

**Component tests (Vitest + jsdom/happy-dom):**
```
tests/unit/client/editor.test.ts       — CodeMirror editor creation, save, dirty state
tests/unit/client/visual.test.ts       — Round-trip: parseMarkdown → docToMarkdown = input
tests/unit/client/sidebar.test.ts      — buildList(), context menu actions
tests/unit/client/preview.test.ts      — startPreview, readiness polling
```

**End-to-end content tests (Playwright):**
```
tests/e2e/visual-editor.spec.ts
  - Open .qmd with frontmatter → switch to visual → frontmatter still present when switching back
  - Open .qmd with $math$ → switch to visual → switch back → math intact
  - Open .qmd with code cell → switch to visual → switch back → {python} attribute intact
  - Type in visual editor → save → read file from disk → content matches

tests/e2e/file-management.spec.ts
  - Create folder
  - Rename file, verify sidebar updates
  - Move file to folder, verify old path 404, new path 200
  - Delete file, verify sidebar removes it

tests/e2e/preview.spec.ts
  - Open file → click Preview → iframe src set within 10s
  - Edit file → save → iframe reloads (WebSocket signal)
```

**Rule to enforce going forward**: Any feature PR must include a test that would have failed before the PR and passes after. PRs without tests for user-visible behavior are blocked.

### Phase F — Quarto Visual Editor Integration (6–8 weeks, after A)

Once Monaco is working and the codebase is stable, integrate the actual Quarto visual editor:

1. Study `quarto-dev/quarto` source (`packages/editor`, `packages/editor-server`)
2. The editor runs as an iframe; the host app communicates via `EditorServer` interface (JSON-RPC over `postMessage`)
3. Implement the server-side pieces: pandoc AST conversion, crossref data, bibliography completion
4. This replaces the Monaco-based source editor for `.qmd` files, giving true WYSIWYG that matches Positron

---

## 4. Immediate Actions (This Sprint)

Before any new features, stabilise what exists:

1. **Disable visual mode** — add a `data-disabled` state to `#btn-mode-visual` with a tooltip "Visual editor coming in a future release". Prevent users from corrupting their files with the current broken round-trip.
2. **Fix dropdown event listener leak** — audit all components that attach `click` handlers to `document` for close-outside logic; replace with a single `ClickOutsideManager` singleton.
3. **Commit user's CSS and serve.ts fixes** — the changes made by the user manually must be committed with a proper description of what was wrong.
4. **Add a `KNOWN_ISSUES.md`** — honest list of what doesn't work yet so users aren't surprised.
5. **Verify Quarto PATH at server start** — fail fast with a clear message rather than cryptic ENOENT on first preview attempt.

---

## 5. Commitments on Testing Discipline Going Forward

| Rule | Enforcement |
|------|-------------|
| Every client component gets a unit test before merging | PR checklist |
| Every API endpoint change requires a matching unit test update (already in place) | CI blocks merge on coverage drop |
| Every E2E test must interact with the UI, not just call APIs via `page.request` | Code review |
| Visual round-trip fidelity test for any markdown feature touched | CI |
| No feature is "done" until it works end-to-end in a Playwright browser session | Definition of Done |

The current test suite was good at catching server regressions. It was never adequate for catching UI correctness. That gap is the reason real problems were declared fixed when they were not.

---

## 6. Summary

| Area | Current State | Target State | Time Estimate |
|------|--------------|--------------|---------------|
| Visual editor | Broken (loses content) | Monaco (source) → Quarto editor (WYSIWYG) | 4–6w (Monaco), +6–8w (Quarto) |
| Preview | Fragile (PATH issues, blank iframe) | Robust with diagnostics, readiness check | 1–2w |
| File management | Read-only tree | Full CRUD + drag-drop + keyboard nav | 2–3w |
| UX polish | Minimal | Tab bar, resizable sidebar, command palette | 3–4w |
| Test suite | API-only | Full pyramid (component + E2E content) | Parallel |

Total realistic timeline to a tool that competes with basic Positron editing: **12–16 weeks** of focused development.

The architectural foundations (server, API design, git integration, WebSocket, export pipeline) are solid and well-tested. The client layer is where the investment needs to go.
