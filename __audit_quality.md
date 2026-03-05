# Quartostone — TypeScript Code Quality Audit

**Date:** 2026-03-05  
**Scope:** `src/server/`, `src/client/`, `src/cli/`, `src/shared/`, `eslint.config.mjs`, `tsconfig.json`, `tsconfig.client.json`  
**Total findings:** 43 (5 HIGH · 19 MEDIUM · 19 LOW)

---

## Table of Contents

1. [TypeScript Strictness](#1-typescript-strictness)
2. [Error Handling](#2-error-handling)
3. [Modularity / God Files](#3-modularity--god-files)
4. [Dead Code](#4-dead-code)
5. [Code Duplication](#5-code-duplication)
6. [Magic Strings](#6-magic-strings)
7. [Async Correctness](#7-async-correctness)
8. [Naming](#8-naming)
9. [ESLint Config](#9-eslint-config)
10. [tsconfig Strictness](#10-tsconfig-strictness)

---

## 1. TypeScript Strictness

### Q01 — `noUncheckedIndexedAccess` not enabled · HIGH

**Files:** `tsconfig.json`, `tsconfig.client.json`  
**Description:** Both tsconfigs have `"strict": true` but omit `"noUncheckedIndexedAccess": true`. As a result, any array/tuple index access returns `T` instead of `T | undefined`, masking potential runtime `undefined` values.  
**Evidence:** `src/server/api/xref.ts` compensates with many `!` assertions (e.g. `lines[i]!`, `headingMatch[1]!`, `headingMatch[2]!`, `divMatch[1]!`, `chunkLabelMatch[1]!`, `lines[j]!`). These would become compile errors under `noUncheckedIndexedAccess`, forcing proper null-checks.  
**Fix:** Add `"noUncheckedIndexedAccess": true` to both tsconfigs. Then audit all resulting errors.

---

### Q02 — `any` types in visual editor · MEDIUM

**File:** `src/client/visual/index.ts` lines 13–17  
**Description:** The panmirror `Window` global declaration uses `any` for both `Editor` and `UITools`, suppressing all type checking on the editor's entire API surface.

```ts
// current
Panmirror?: {
  Editor: any;   // ← any
  UITools: any;  // ← any, and UITools is never used
};
```

**Fix:** Define a minimal but typed interface for `Editor` (covering `create`, `subscribe`, `setMarkdown`, `getMarkdown`, `destroy`). `UITools` should be removed entirely as it is never referenced (see Q22).

---

### Q03 — Ubiquitous `!` non-null assertions on DOM elements in `main.ts` · MEDIUM

**File:** `src/client/main.ts` lines 36–80  
**Description:** Approximately 40 `document.getElementById(...)!` non-null assertions appear at module scope before any DOM-ready guard. If any element is missing (e.g. during unit tests that don't provide the full HTML), these assertions throw at parse time rather than producing a meaningful error.

```ts
const fileTreeEl = document.getElementById('file-tree')!; // × 40 more
```

**Fix:** Either (a) assert once in an init function with a meaningful error message, or (b) use an `ensureEl<T>(id: string): T` helper that throws with context. At minimum, add a startup validation pass.

---

### Q04 — `as` casts on unvalidated request parameters · MEDIUM

**Files:** `src/server/api/pages.ts`, `src/server/api/git.ts`, `src/server/api/render.ts`, etc.  
**Description:** Route handlers cast `req.params[0]`, `req.query['path']`, and `req.body` fields with `as` without runtime validation. For example:

```ts
// pages.ts
const filePath = guardPath(req.params[0] as string, res);

// git.ts
const { message } = req.body as { message?: string };
```

While most handlers do validate immediately after, the cast happens before the check, meaning TypeScript does not catch callers that trust the cast without adding a check. Some handlers in `db.ts` and `export.ts` call `resolveAndCheck` which does not guarantee the query param is a string (`req.query['path'] as string | undefined` includes `string | string[] | ParsedQs | ParsedQs[]` from Express).  
**Fix:** Use a validated accessor: `const pathParam = typeof req.query['path'] === 'string' ? req.query['path'] : null` before casting.

---

### Q05 — Unchecked cast `result.code as string` in visual editor · MEDIUM

**File:** `src/client/visual/index.ts` lines 116–118  
**Description:**

```ts
async getMarkdown(): Promise<string> {
  const result = await editor.getMarkdown(PANDOC_WRITER_OPTIONS);
  return (result.code as string) ?? '';
}
```

`editor` is typed `any` (Q02), so `result.code` is also `any`. The `as string` cast is unsafe — if the panmirror API changes or returns `undefined`, the `??` will not catch it because `as string` forces the type.  
**Fix:** After typing `Editor` properly, validate `result.code` with `typeof result.code === 'string' ? result.code : ''`.

---

### Q06 — `explicit-module-boundary-types` only a warning · LOW

**File:** `eslint.config.mjs`  
**Description:** Missing return types on exported functions are only warned, not errors. Several exported client functions have no return type annotation, e.g. `buildEditorUI()`, `buildEditorUIPrefs()`, `buildEditorDisplay()`, `buildEditorUIContext()`, `buildEditorDialogs()` in `editorUI.ts`. The inferred return type becomes a wide structural type that drifts silently.  
**Fix:** Upgrade `@typescript-eslint/explicit-module-boundary-types` to `'error'` and add explicit return types to all exported items.

---

## 2. Error Handling

### Q07 — `async` callback in `proc.on('close', ...)` creates unhandled rejection · HIGH

**File:** `src/server/watcher.ts` lines 66–93  
**Description:**

```ts
proc.on('close', async (code) => {
  if (code !== 0) { ... return; }
  ctx.broadcast('render:complete', { path: relPath });
  if (ctx.config.commit_mode === 'auto') {
    try {
      await git.add(filePath);
      await git.commit(message);
      ctx.broadcast('git:committed', { message });
    } catch (e) {
      ctx.broadcast('git:error', { error: String(e) });
    }
  }
});
```

The async callback passed to `proc.on('close', ...)` is an `EventEmitter` listener. Node.js does not know it returns a Promise, so any rejection inside the `try` block that slips past the explicit `catch` (e.g. in a deeply nested `await`) produces an unhandled promise rejection. The logic is correctly wrapped in `try/catch` today, but this structural pattern is fragile.  
**Fix:** Wrap the entire `async (code) => { ... }` body in `(async (code) => { ... })().catch(err => ctx.broadcast('git:error', ...))` to explicitly handle the promise.

---

### Q08 — Floating promises in `editor/index.ts` drag-drop handlers swallow errors · HIGH

**File:** `src/client/editor/index.ts` lines 48–87  
**Description:**

```ts
void (async () => {
  for (const file of files) {
    const url = await uploadImageFile(file);
    if (!url) continue; // upload error is silently ignored
    ...
  }
})();
```

Both the `drop` and `paste` handlers use `void (async () => { ... })()`. Any exception inside is silently discarded. The user receives no feedback when an image upload fails; the markdown insertion simply doesn't occur.  
**Fix:** Add a `.catch(err => { /* dispatch user-visible message or show toast */ })` chain.

---

### Q09 — `xref.ts` mutates shared cache object during `/api/xref/forId` · HIGH

**File:** `src/server/api/xref.ts` lines 285–292  
**Description:**

```ts
app.post('/api/xref/forId', (req, res) => {
  const all = scanXRefsWithCache(pagesDir, file);
  all.refs = all.refs.filter(r => ...);  // ← MUTATES the cached object!
  res.json(all);
});
```

`scanXRefsWithCache` returns `xrefCache` (the module-level object) when the cache is valid. Assigning `all.refs = all.refs.filter(...)` mutates `xrefCache.refs` in place. A subsequent call to `/api/xref/index` before the cache is invalidated will return the reduced (filtered) set of refs rather than all refs.  
**Fix:**

```ts
const all = scanXRefsWithCache(pagesDir, file);
const filtered = all.refs.filter(r => ...);
res.json({ ...all, refs: filtered });
```

---

### Q10 — Silent `catch {}` blocks suppress non-trivial startup errors · MEDIUM

**File:** `src/server/index.ts` lines 98–101  
**Description:**

```ts
try {
  rebuildLinkIndex(pagesDir);
} catch {
  /* empty workspace */
}
try {
  rebuildSearchIndex(pagesDir);
} catch {
  /* empty workspace */
}
```

The comment says "empty workspace" but these functions can also throw for file permission errors, out-of-memory conditions, or corrupt files. Such errors are silently swallowed.  
**Fix:**

```ts
try {
  rebuildLinkIndex(pagesDir);
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') logWarn(`Link index build failed: ${e}`);
}
```

---

### Q11 — Browser `alert()` used in git panel instead of toast · MEDIUM

**File:** `src/client/git/index.ts` (multiple locations)  
**Description:** Several error paths use `alert()` directly:

```ts
alert(`Failed to set remote: ${err.error ?? 'unknown error'}`);
alert('Push failed: network error');
alert('Pull failed: network error');
```

`alert()` blocks the browser main thread, cannot be styled, cannot be dismissed programmatically, and is inaccessible in headless test environments.  
**Fix:** Accept a `showToast` callback parameter (just as `initBranchPicker` does) and replace all `alert()` calls with it.

---

### Q12 — `exec(cmd)` in `serve.ts` discards errors · MEDIUM

**File:** `src/cli/commands/serve.ts` lines 28–33  
**Description:**

```ts
import('node:child_process').then(({ exec }) => {
  exec(cmd); // ← no callback; errors silently discarded
});
```

`exec` without a callback silently ignores failures. On Windows, `start` via `cmd.exe` can fail silently if the URL is malformed or if the shell is restricted.  
**Fix:**

```ts
exec(cmd, (err) => {
  if (err) console.warn(`Could not open browser: ${err.message}`);
});
```

---

### Q13 — `getMarkdown().then(...).catch(() => {})` is a no-op error handler · LOW

**File:** `src/client/main.ts` line ~213  
**Description:**

```ts
activeVisual
  ?.getMarkdown()
  .then((md) => {
    visualMarkdownCache = md;
  })
  .catch(() => {});
```

The `.catch(() => {})` silently swallows panmirror serialisation errors. If markdown retrieval fails repeatedly, `visualMarkdownCache` goes stale and the properties panel displays outdated content without any indication.  
**Fix:** Log or surface the error: `.catch(err => console.warn('[VisualEditor] getMarkdown failed:', err))`.

---

### Q14 — `void load(path)` in backlinks/preview panels with silent catch · LOW

**Files:** `src/client/backlinks/index.ts` line ~82, `src/client/preview/index.ts` line ~51  
**Description:** Both panels fire `void load(path)` / `void startPreview(path)` from `setPage`, discarding the returned promise. Errors in `load()` are caught internally but only set an inline DOM message, not surfacing to the outer caller's error system.  
**Fix:** Acceptable for these panels, but at minimum the internal `catch` should not prevent re-renders on subsequent calls (currently the panel stays in error state indefinitely after one failure unless `setPage` is called again).

---

## 3. Modularity / God Files

### Q15 — `main.ts` is a 1100+ line god file · HIGH

**File:** `src/client/main.ts`  
**Description:** `main.ts` acts as the application root and directly implements:

- All DOM state management (40+ module-level DOM references)
- Editor lifecycle (open, close, save, switch modes)
- Tab bar coordination (primary + secondary panes)
- Split pane drag-to-resize
- Command palette rendering and keyboard handling
- Git commit dialog flow
- Auto-commit timer
- Sidebar resizer drag
- Keyboard shortcuts registry
- Status bar updates
- Branch status polling
- WebSocket live-reload handler

This violates the single-responsibility principle heavily. Any test of one feature requires understanding the full 1100-line module.  
**Fix:** Extract into smaller modules:

- `src/client/state/editorState.ts` — active path, dirty flag, mode
- `src/client/editor/lifecycle.ts` — `openPage`, `saveCurrentPage`, `switchMode`
- `src/client/ui/commitDialog.ts` — commit dialog + auto-commit timer
- `src/client/ui/splitPane.ts` — split pane resize and pane focus management
- `src/client/ui/statusBar.ts` — `updateBranchStatus`, status bar click handlers
- `src/client/keyboard.ts` — global keyboard shortcut registration

---

### Q16 — `sidebar/index.ts` handles too many responsibilities · MEDIUM

**File:** `src/client/sidebar/index.ts` (~600 lines total)  
**Description:** The sidebar module combines: context menu engine, inline rename, drag-and-drop move, favorites/recent management, tag filtering, tree rendering, trash management, and the "Move to…" folder dialog. These are largely independent concerns.  
**Fix:** Extract `contextMenu.ts`, `inlineRename.ts`, and `recentFavorites.ts` as separate modules.

---

### Q17 — Module-level mutable singleton state in server API modules · MEDIUM

**Files:** `src/server/api/links.ts`, `src/server/api/search.ts`, `src/server/api/xref.ts`, `src/server/api/preview.ts`, `src/server/api/export.ts`  
**Description:** All these modules maintain process-global in-memory state (e.g. `forwardLinks`, `pageMeta`, `index`, `xrefCache`, `previews`, `jobs`) at module scope. This makes the server stateful in a non-obvious way: multiple calls to `registerLinksApi` or `registerSearchApi` (e.g. in integration tests) share the same index. Tests must use the exported `reset*` helpers to avoid cross-contamination.  
**Fix:** Encapsulate state in a class or factory function and pass instances through `ServerContext`. Example: `ctx.linkIndex` becomes an injected `LinkIndex` instance.

---

### Q18 — `setInterval` side effect runs at module load in `export.ts` · MEDIUM

**File:** `src/server/api/export.ts` lines 57–66  
**Description:**

```ts
setInterval(
  () => {
    // cleanup old jobs
  },
  5 * 60 * 1000
).unref();
```

This `setInterval` runs as a top-level side effect when the module is imported. Every test that imports `export.ts` inadvertently starts a background timer. While `.unref()` prevents it from keeping the process alive, the timer still runs during tests and can cause unexpected cleanup behaviour.  
**Fix:** Move the cleanup interval into `registerExportApi` and return a teardown function, or expose a `stopCleanup()` export for tests.

---

## 4. Dead Code

### Q19 — `setDirtyTab` function defined but never called · LOW

**File:** `src/client/main.ts` near line ~850  
**Description:**

```ts
function setDirtyTab(dirty: boolean) {
  if (activePath) primaryTabs.markDirty(activePath, dirty);
}
```

`setDirtyTab` is defined but never called anywhere in the module. All dirty marking is done inline via `primaryTabs.markDirty(...)` calls directly.  
**Fix:** Remove the function.

---

### Q20 — `_filePath` parameter in `xref.ts` is permanently unused · LOW

**File:** `src/server/api/xref.ts` lines ~205, ~250  
**Description:** Both `scanXRefsInProject` and `scanXRefsWithCache` accept a `_filePath?: string` parameter described as "reserved for future scoped scanning." This placeholder has existed since initial implementation and adds noise to every call site.  
**Fix:** Remove the parameter now and restore it if/when scoped scanning is actually implemented.

---

### Q21 — `_pagePath` parameter in `properties/index.ts` is unused · LOW

**File:** `src/client/properties/index.ts` line ~110  
**Description:**

```ts
function mount(
  _pagePath: string,   // ← never used inside mount()
  getContent: () => string | Promise<string>,
  setContent: (s: string) => void,
) {
```

The path is passed in everywhere but never referenced inside `mount`, `render`, or `buildForm`.  
**Fix:** Remove the parameter, or actually use it (e.g. to derive a relative base path for links).

---

### Q22 — `API.exportFormats` references a non-existent endpoint · MEDIUM

**File:** `src/client/api/endpoints.ts` line 48  
**Description:**

```ts
exportFormats: '/api/export/formats',
```

There is no `/api/export/formats` route registered in `src/server/api/export.ts`. The registered routes are `/api/export`, `/api/export/status`, and `/api/export/download`. This dead constant would silently 404 if used.  
**Fix:** Remove `exportFormats` from `API`, or add the corresponding route to `export.ts` (which could return `SUPPORTED_FORMATS`).

---

### Q23 — `UITools: any` declared in `visual/index.ts` but never used · LOW

**File:** `src/client/visual/index.ts` line 16  
**Description:**

```ts
interface Window {
  Panmirror?: {
    Editor: any;
    UITools: any; // ← never referenced anywhere
  };
}
```

`UITools` is declared in the global augmentation but no code ever accesses `window.Panmirror.UITools`.  
**Fix:** Remove `UITools` from the interface declaration.

---

## 5. Code Duplication

### Q24 — `escHtml` duplicated between `sidebar/index.ts` and `utils/escape.ts` · MEDIUM

**Files:** `src/client/sidebar/index.ts` line ~33, `src/client/utils/escape.ts` line 1  
**Description:** `sidebar/index.ts` declares its own local `escHtml` function with identical implementation to the exported `escHtml` in `utils/escape.ts`. Other modules (`git/index.ts`, `database/index.ts`, `history/index.ts`) correctly import from `utils/escape.ts`.

```ts
// sidebar/index.ts (local copy — never exported)
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

**Fix:** Remove the local copy and `import { escHtml } from '../utils/escape.js'`.

---

### Q25 — Frontmatter parsing duplicated between client and server · MEDIUM

**Files:** `src/client/properties/index.ts` lines ~31–90, `src/server/utils/frontmatter.ts`  
**Description:** The properties panel implements its own `parseFrontmatter`, `parseYamlSimple`, `coerce`, and `serializeFrontmatter` functions. The server has a shared `src/server/utils/frontmatter.ts`. Neither is in `src/shared/`, so the client cannot import the server version.

There are subtle differences: the client's `parseYamlSimple` handles multi-line YAML lists that the server's `yaml` library handles automatically. The client's `serializeFrontmatter` writes quotes for values containing `:` but the server's `yaml.stringify` does not always match.  
**Fix:** Move core frontmatter parsing/serialisation to `src/shared/frontmatter.ts` that both server and client import. The server utility can wrap it with the `yaml` package for full YAML support; the client receives the same types.

---

### Q26 — Auto-commit slug generation duplicated in client, bypasses configured pattern · MEDIUM

**Files:** `src/client/main.ts` (×2), `src/client/git/index.ts` (×1)  
**Description:** Three places in the client generate commit slugs the same way:

```ts
const slug = `qs-${Math.random().toString(36).slice(2, 10)}`;
```

This hard-codes the `qs-` prefix and uses `Math.random` / `toString(36)`, while the server uses `generateCommitSlug(config.commit_message_auto)` which honours the user-configured pattern (e.g. `qs-{alphanum8}` or any custom format). Client-generated slugs always be `qs-<base36>` regardless of config.  
**Fix:** Either expose the configured pattern via an API endpoint (e.g. `GET /api/config`) and use it on the client, or move slug generation entirely to the server's commit endpoint.

---

### Q27 — `UUID_RE` pattern duplicated in `trash.ts` · LOW

**File:** `src/server/api/trash.ts` lines 46, 74  
**Description:** The same UUID validation regex is declared twice inside the same file:

```ts
app.post('/api/trash/restore/:id', (req, res) => {
  const UUID_RE = /^[0-9a-f]{8}.../i;
  ...
});
app.delete('/api/trash/:id', (req, res) => {
  const UUID_RE = /^[0-9a-f]{8}.../i;
  ...
});
```

**Fix:** Hoist `UUID_RE` to module scope as a `const`.

---

### Q28 — Drag-to-resize mousedown/mousemove/mouseup pattern duplicated three times · LOW

**Files:** `src/client/main.ts` (sidebar resizer ~line 810, pane divider ~line 1050), `src/client/preview/index.ts` (preview resizer)  
**Description:** All three resizers implement the same pattern: capture `startX`, attach `mousemove`/`mouseup` to `document`, compute new width clamped to min/max, remove listeners on `mouseup`. Approximately 20 lines each, 60 lines total.  
**Fix:** Extract a `makeResizer(options: { element, minWidth, maxWidth, onResize })` utility in `src/client/utils/resizer.ts`.

---

## 6. Magic Strings

### Q29 — `pages/${slug}.qmd` hard-coded in `main.ts`, ignores configured `pages_dir` · MEDIUM

**File:** `src/client/main.ts` line ~378  
**Description:**

```ts
const path = `pages/${slug}.qmd`;
const res = await fetch(`/api/db/create?path=${encodeURIComponent(path)}`, ...);
```

The client hard-codes `pages/` regardless of what `pages_dir` is configured to. If the user configures `pages_dir: docs`, newly created databases are created at `pages/...` (which may not even exist) rather than `docs/...`.  
**Fix:** Expose `pages_dir` via `GET /api/config` (or via the existing `/api/pages` tree which already uses it server-side), then build the path client-side from the returned configuration.

---

### Q30 — localStorage keys scattered as isolated string literals · LOW

**Files:** `src/client/sidebar/index.ts` (`'qs_favorites'`, `'qs_recent'`), `src/client/theme.ts` (`'qs_theme'`), `src/client/main.ts` (`'qs_sidebar_width'`), `src/client/graph/index.ts` (`'qs-graph-${n.id}'`)  
**Description:** All localStorage keys are raw string literals defined at their usage sites. A typo in any key creates a silent data loss (the old key is orphaned). The `graph` module uses a different prefix style (`qs-graph-*`) vs. the others (`qs_*`).  
**Fix:** Centralise all storage keys in `src/client/storage.ts`:

```ts
export const STORAGE_KEYS = {
  favorites: 'qs_favorites',
  recent: 'qs_recent',
  theme: 'qs_theme',
  sidebarWidth: 'qs_sidebar_width',
  graphNodePrefix: 'qs_graph_',
} as const;
```

---

### Q31 — `/api/*` endpoint paths used as raw strings in many client modules, `API` constants not consistently used · LOW

**Files:** `src/client/branches/index.ts`, `src/client/editor/index.ts`, `src/client/backlinks/index.ts`, `src/client/preview/index.ts`, `src/client/search/index.ts`, `src/client/export/index.ts`  
**Description:** `src/client/api/endpoints.ts` provides an `API` constant object, but only some modules import it. Most client modules construct URLs inline:

```ts
// branches/index.ts (no API import)
await fetch('/api/git/branches', ...)
await fetch('/api/git/checkout', ...)

// preview/index.ts (no API import)
await fetch('/api/preview/start', ...)
```

**Fix:** Import and use `API.*` constants in all client modules. This enables refactoring server routes in one place.

---

### Q32 — `'qs-'` prefix repeated verbatim in three client files · LOW

**Files:** `src/client/main.ts` (×2), `src/client/git/index.ts`  
**Description:** The auto-commit slug always starts with `qs-` but this is encoded as a string literal three times. If the prefix ever changes, all instances must be updated manually.  
**Fix:** Once Q26 is resolved (slug generation moves server-side), this is no longer an issue. As an interim, define `const QS_SLUG_PREFIX = 'qs-'` in `src/client/api/endpoints.ts`.

---

## 7. Async Correctness

### Q33 — `BacklinksPanel.setPage` interface typed as `void` but implementation is async · LOW

**File:** `src/client/backlinks/index.ts` lines 70–82  
**Description:**

```ts
export interface BacklinksPanel {
  setPage(path: string | null): void;  // ← interface says void
  ...
}

// implementation
setPage(path): void {
  currentPath = path;
  if (path) {
    void load(path);  // fires async work without awaiting
  }
  ...
}
```

Callers cannot `await` `setPage` to know when backlinks are populated. The `PreviewPanel.setPage` has the same mismatch (interface says `void`, implementation is `async`). This is intentional fire-and-forget behaviour, but callers cannot detect completion.  
**Fix:** Change interface signatures to `setPage(path: string | null): void | Promise<void>` or explicitly document the fire-and-forget intent with a comment.

---

### Q34 — `staleMarkdownCache` used in properties panel instead of live content · LOW

**File:** `src/client/main.ts` lines ~252–270, `src/client/properties/index.ts`  
**Description:** The `getContent` closure passed to `propsPanel.mount` in visual mode returns `visualMarkdownCache` (a string updated asynchronously in the background) rather than the live `activeVisual.getMarkdown()` promise:

```ts
const getContent = () =>
  editorMode === 'visual' && activeVisual
    ? visualMarkdownCache // potentially stale
    : activeView
      ? activeView.state.doc.toString()
      : '';
```

If the visual mode cache hasn't been updated yet (e.g. the user just switched to visual mode), the properties panel receives stale or empty markdown.  
**Fix:** Change `getContent` in visual mode to return `activeVisual.getMarkdown()` directly — `PropertiesPanel.mount` already accepts `() => string | Promise<string>`.

---

### Q35 — `proc.on('close', async ...)` without top-level error handler in `render.ts` · MEDIUM

**File:** `src/server/api/render.ts` lines 55–65  
**Description:** The `proc.on('close', (code) => { ... })` callback is not async, so this is not a direct async problem. However, the `responded` flag is captured in a closure that is also shared with the `setTimeout` timer. A race condition exists: if `child.kill()` is called by the timer and then `close` fires with a non-zero code, both branches attempt to respond, relying on `if (responded) return` to dedup. The `responded` variable is not atomic; in Node.js single-threaded execution this works, but it is worth making it explicit.  
**Fix:** The existing guard is technically sufficient for Node.js. Consider using `AbortController` / `Signal` instead of the `responded` boolean for clearer semantics.

---

## 8. Naming

### Q36 — `conflict` local variable shadows imported `conflict` function in `git.ts` · MEDIUM

**File:** `src/server/api/git.ts` line ~148  
**Description:**

```ts
import { badRequest, notFound, serverError } from '../utils/errorResponse.js';

// ...inside POST /api/git/pull:
const conflict = msg.includes('CONFLICT') || msg.includes('not possible to fast-forward');
res.status(conflict ? 409 : 500).json({ ..., conflict });
```

The variable name `conflict` shadows the `conflict` function **imported from errorResponse.ts** (which is used as `conflict(res, 'message')`). The import at the top does not import `conflict` specifically, but the ambiguity could cause confusion when adding one later.  
**Fix:** Rename the local variable to `isConflict` or `hasConflict`.

---

### Q37 — `_renderBreadcrumb` alias creates a confusing double-name · LOW

**File:** `src/client/main.ts` lines 23, 473  
**Description:**

```ts
import { renderBreadcrumb as _renderBreadcrumb } from './breadcrumb.js';
// ...
function renderBreadcrumb(path: string | null): void {
  const el = document.getElementById('editor-breadcrumb') as HTMLElement | null;
  _renderBreadcrumb(path, el!, ...);
}
```

The module-level wrapper `renderBreadcrumb` hides the pure function. Readers need to mentally track both names. The alias `_renderBreadcrumb` looks like it's "unused" (matching the `_`-prefix convention) when it is actually called.  
**Fix:** Import the pure function under its real name and give the wrapper a distinct name: `import { renderBreadcrumb as renderBreadcrumbPure } from './breadcrumb.js'` and name the wrapper `updateBreadcrumb` or `bindBreadcrumb`.

---

### Q38 — `propsPanel` vs `propertiesPanel` creates confusing near-duplicates · LOW

**File:** `src/client/main.ts` lines ~70, ~82  
**Description:**

```ts
const propertiesPanel = document.getElementById('properties-panel')!; // DOM element
const propsPanel = createPropertiesPanel(propertiesBody); // JS object
```

Two nearly-identical names refer to different types (DOM element vs controller object). Readers routinely need to check which is the DOM element and which is the controller.  
**Fix:** Rename `propsPanel` to `propertiesController` or `propsPanelController`.

---

## 9. ESLint Config

### Q39 — `@typescript-eslint/no-explicit-any` set to `warn`, not `error` · MEDIUM

**File:** `eslint.config.mjs` line 11  
**Description:**

```js
'@typescript-eslint/no-explicit-any': 'warn',
```

`any` types are only warned about. This allows the two `any` usages in `visual/index.ts` (Q02) to remain silently in CI and are easy to ignore in a busy PR pipeline.  
**Fix:** Change to `'error'`. Fix the two remaining `any` usages first (see Q02).

---

### Q40 — No `@typescript-eslint/no-non-null-assertion` rule · MEDIUM

**File:** `eslint.config.mjs`  
**Description:** Non-null assertions (`!`) are entirely unchecked by ESLint. The codebase has approximately 75 `!` assertions across server and client code. With `noUncheckedIndexedAccess` (Q01) these would cascade into many new assertions that need justification.  
**Fix:** Add `'@typescript-eslint/no-non-null-assertion': 'warn'`. Then progressively replace `!` with proper null checks or `??` or `if (!x) return` guards.

---

### Q41 — No typed lint rules (`@typescript-eslint/no-unsafe-*`) · MEDIUM

**File:** `eslint.config.mjs`  
**Description:** The ESLint config uses `tseslint.configs.recommended` but not `tseslint.configs.recommendedTypeChecked`. As a result, the stricter rules that require TypeScript type information — `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`, `no-floating-promises` — are all absent. These rules would catch the floating-promise issues in Q08 and Q13 at lint-time.  
**Fix:** Add `...tseslint.configs.recommendedTypeChecked` to the config array with `languageOptions: { parserOptions: { projectService: true } }`. This requires slightly longer lint times but catches an entire class of async and type-safety errors.

---

### Q42 — `explicit-module-boundary-types` scoped to `src/` only, misses shared/ · LOW

**File:** `eslint.config.mjs` line 18  
**Description:**

```js
{ files: ['src/**/*.ts'], rules: { '@typescript-eslint/explicit-module-boundary-types': 'warn' } }
```

The glob `src/**/*.ts` does cover `src/shared/**/*.ts`, so this is functionally correct. However, the `no-console` rule is also scoped to `src/`, which means `tests/**/*.ts` permit `console.log` — acceptable.  
**Note:** No actionable fix needed; informational only.

---

## 10. tsconfig Strictness

### Q43 — Both tsconfigs missing several useful strict flags · MEDIUM

**Files:** `tsconfig.json`, `tsconfig.client.json`  
**Description:** The following flags are not set in either tsconfig:

| Flag                                 | Effect                                                   | Recommended                 |
| ------------------------------------ | -------------------------------------------------------- | --------------------------- |
| `noUncheckedIndexedAccess`           | Array/object index returns `T \| undefined`              | Yes (HIGH impact — see Q01) |
| `exactOptionalPropertyTypes`         | `{ x?: string }` disallows `{ x: undefined }`            | Yes                         |
| `noImplicitOverride`                 | Methods that shadow a base class must use `override`     | Low risk — add later        |
| `noPropertyAccessFromIndexSignature` | Requires bracket notation for index-signature properties | Optional                    |

`strict: true` is correctly set (enables `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `noImplicitAny`, `noImplicitThis`, `alwaysStrict`).  
`skipLibCheck: true` is used in both configs — acceptable for third-party types but hides type errors if the project's own `declaration: true` output has issues.  
**Fix:** Add `"noUncheckedIndexedAccess": true` and `"exactOptionalPropertyTypes": true` to both tsconfigs immediately. Address resulting type errors.

---

## Summary Table

| ID  | Category          | Severity | File(s)                                                      |
| --- | ----------------- | -------- | ------------------------------------------------------------ |
| Q01 | TS Strictness     | HIGH     | tsconfig.json, tsconfig.client.json                          |
| Q02 | TS Strictness     | MEDIUM   | visual/index.ts                                              |
| Q03 | TS Strictness     | MEDIUM   | main.ts                                                      |
| Q04 | TS Strictness     | MEDIUM   | pages.ts, git.ts, render.ts                                  |
| Q05 | TS Strictness     | MEDIUM   | visual/index.ts                                              |
| Q06 | TS Strictness     | LOW      | eslint.config.mjs                                            |
| Q07 | Error Handling    | HIGH     | watcher.ts                                                   |
| Q08 | Error Handling    | HIGH     | editor/index.ts                                              |
| Q09 | Error Handling    | HIGH     | xref.ts                                                      |
| Q10 | Error Handling    | MEDIUM   | server/index.ts                                              |
| Q11 | Error Handling    | MEDIUM   | git/index.ts (client)                                        |
| Q12 | Error Handling    | MEDIUM   | serve.ts                                                     |
| Q13 | Error Handling    | LOW      | main.ts                                                      |
| Q14 | Error Handling    | LOW      | backlinks/index.ts, preview/index.ts                         |
| Q15 | Modularity        | HIGH     | main.ts                                                      |
| Q16 | Modularity        | MEDIUM   | sidebar/index.ts                                             |
| Q17 | Modularity        | MEDIUM   | links.ts, search.ts, xref.ts, preview.ts, export.ts          |
| Q18 | Modularity        | MEDIUM   | export.ts                                                    |
| Q19 | Dead Code         | LOW      | main.ts                                                      |
| Q20 | Dead Code         | LOW      | xref.ts                                                      |
| Q21 | Dead Code         | LOW      | properties/index.ts                                          |
| Q22 | Dead Code         | MEDIUM   | api/endpoints.ts                                             |
| Q23 | Dead Code         | LOW      | visual/index.ts                                              |
| Q24 | Duplication       | MEDIUM   | sidebar/index.ts, utils/escape.ts                            |
| Q25 | Duplication       | MEDIUM   | properties/index.ts, server/utils/frontmatter.ts             |
| Q26 | Duplication       | MEDIUM   | main.ts, git/index.ts (client)                               |
| Q27 | Duplication       | LOW      | trash.ts                                                     |
| Q28 | Duplication       | LOW      | main.ts, preview/index.ts, sidebar resizer                   |
| Q29 | Magic Strings     | MEDIUM   | main.ts                                                      |
| Q30 | Magic Strings     | LOW      | sidebar/index.ts, theme.ts, main.ts, graph/index.ts          |
| Q31 | Magic Strings     | LOW      | branches/index.ts, editor/index.ts, preview/index.ts, others |
| Q32 | Magic Strings     | LOW      | main.ts, git/index.ts (client)                               |
| Q33 | Async Correctness | LOW      | backlinks/index.ts, preview/index.ts                         |
| Q34 | Async Correctness | LOW      | main.ts, properties/index.ts                                 |
| Q35 | Async Correctness | MEDIUM   | render.ts                                                    |
| Q36 | Naming            | MEDIUM   | api/git.ts                                                   |
| Q37 | Naming            | LOW      | main.ts                                                      |
| Q38 | Naming            | LOW      | main.ts                                                      |
| Q39 | ESLint Config     | MEDIUM   | eslint.config.mjs                                            |
| Q40 | ESLint Config     | MEDIUM   | eslint.config.mjs                                            |
| Q41 | ESLint Config     | MEDIUM   | eslint.config.mjs                                            |
| Q42 | ESLint Config     | LOW      | eslint.config.mjs                                            |
| Q43 | tsconfig          | MEDIUM   | tsconfig.json, tsconfig.client.json                          |

---

## Recommended Priority Order

### Immediate (HIGH impact, low risk of regression)

1. **Q09** — Fix cache mutation in `xref.ts` (spread the result object before filtering)
2. **Q07** — Add top-level `.catch()` to the `proc.on('close', async ...)` in `watcher.ts`
3. **Q01 + Q43** — Add `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` to both tsconfigs, then fix compile errors
4. **Q08** — Add `.catch(err => showToast/log)` to floating promises in `editor/index.ts` drag-drop handlers

### Short-term (MEDIUM impact, contained changes)

5. **Q22** — Remove dead `API.exportFormats` constant or add the route
6. **Q29** — Fix hard-coded `pages/` in `main.ts` database creation
7. **Q26** — Unify commit slug generation to server-side
8. **Q39 + Q40 + Q41** — Upgrade ESLint: `no-explicit-any` → error, add `no-non-null-assertion`, add typed rules
9. **Q24** — Remove duplicate `escHtml` in sidebar
10. **Q36** — Rename `conflict` local variable in `git.ts`
11. **Q25** — Move frontmatter parsing to `src/shared/`

### Longer-term (Refactoring)

12. **Q15** — Break up `main.ts` god file
13. **Q17** — Encapsulate server module state in class/factory
14. **Q18** — Move `setInterval` inside `registerExportApi`
15. **Q30 + Q31** — Centralise localStorage keys, use `API.*` constants everywhere
