# Architecture & Modularity Audit — quartostone

**Date:** 2026-03-05  
**Scope:** `src/server/`, `src/client/main.ts`, `src/client/api/`, `src/shared/`, `src/cli/`, `vite.config.ts`, `package.json`

---

## Summary

| Severity  | Count  |
| --------- | ------ |
| HIGH      | 1      |
| MEDIUM    | 6      |
| LOW       | 7      |
| **Total** | **14** |

---

## Section 1 — God Files

### A01 · `src/client/main.ts` — 971 lines · HIGH

**What it does:** The entire client application wired into one file. Responsibilities include:

- All DOM element queries (~40 `getElementById` / `querySelector` calls)
- Editor mode switching (source ↔ visual)
- Split-pane management (open/close, focus tracking, secondary editor lifecycle)
- Save, auto-save, and dirty-state management
- Commit dialog and auto-commit logic (with 30 s timer)
- WebSocket event handling (`render:complete`, `git:prompt`, `git:committed`, etc.)
- Branch status polling (every 30 s)
- Command palette setup and filtering
- `showCommitPrompt()` builds and injects styled toast HTML inline
- Properties panel show/hide and content sync between source and visual editors
- Raw `fetch()` calls to 6 different API areas

**Recommended fix:** Extract into focused sub-modules alongside the existing pattern already used elsewhere:

| New module                        | Responsibility                                 |
| --------------------------------- | ---------------------------------------------- |
| `src/client/editor/modeSwitch.ts` | Source ↔ visual editor switching               |
| `src/client/split/index.ts`       | Split pane open/close/focus state              |
| `src/client/commit/index.ts`      | Commit dialog, auto-commit, `showCommitPrompt` |
| `src/client/ws/index.ts`          | WebSocket connection and event dispatch        |
| `src/client/status/index.ts`      | Branch-status polling, status bar updates      |

`main.ts` should shrink to a wiring/bootstrap file of < 200 lines.

---

## Section 2 — Module-level Global State

All issues below make parallel or repeated test execution unreliable because state bleeds between tests unless the module-level reset helpers are called in `beforeEach`.

### A02 · `src/server/api/links.ts` — `forwardLinks`, `pageMeta` · MEDIUM

```ts
const forwardLinks = new Map<string, Set<string>>();
const pageMeta = new Map<string, PageMeta>();
```

Singletons at module scope. Two apps in the same process (e.g. integration-test suite running multiple `createApp()` instances) share a single link index.

**Fix:** Move both Maps into a `LinkIndex` class and pass an instance through `ServerContext`. The existing `rebuildLinkIndex` / `updateLinkIndexForFile` / `removeLinkIndexForFile` exports become methods.

---

### A03 · `src/server/api/search.ts` — `index` · MEDIUM

```ts
const index = new Map<string, IndexEntry>();
```

Same problem as A02. Additionally `index` is exported for tests, confirming the test-isolation concern.

**Fix:** Same pattern — `SearchIndex` class, instance in `ServerContext`.

---

### A04 · `src/server/api/preview.ts` — `previews`, `_quartoExe`, `_exitListenerRegistered` · MEDIUM

```ts
const previews = new Map<string, PreviewProcess>();
let _quartoExe: string | null | undefined = undefined;
let _exitListenerRegistered = false;
```

`_quartoExe` is lazily resolved once and reused for the process lifetime — fine in production but prevents tests from overriding the quarto binary path. `_exitListenerRegistered` guards a `process.on('exit')` registration that leaks across test runs.

**Fix:** Accept an optional `quartoPath` override in `ServerContext`. Encapsulate process registry and exit listener in a `PreviewManager` class.

---

### A05 · `src/server/api/export.ts` — `jobs` · MEDIUM

```ts
const jobs = new Map<string, ExportJob>();
```

The periodic `setInterval` cleanup timer (interval fires every 5 min) is also started at module-load time and cannot be stopped between tests.

**Fix:** `ExportManager` class; call `.destroy()` in test teardown. Or at minimum expose a `resetJobStore()` helper alongside the existing pattern.

---

### A06 · `src/server/api/xref.ts` — `xrefCache`, `xrefCacheDirty` (exported) · MEDIUM

```ts
export let xrefCache: XRefs | null = null;
let xrefCacheDirty = true;
```

`xrefCache` is exported as a mutable `let`, making it modifiable from any importer—this is stronger than the `resetXrefCache()` helper pattern used in `search.ts`. Test isolation relies on remembering to call `resetXrefCache()`.

**Fix:** Do not export `xrefCache` as a mutable binding. Only export `resetXrefCache()`. Same class-based fix applies.

---

### A07 · `src/server/api/pandoc.ts` — `capabilitiesCache` · LOW

```ts
let capabilitiesCache: unknown | null = null;
```

`resetCapabilitiesCache()` is exported for tests, which is fine. The issue is minor: there is no TTL, so a server that upgrades pandoc without restarting will serve stale capability data.

**Fix:** Add a TTL (e.g. 24 h) or expose a POST `/api/pandoc/capabilities/clear` admin endpoint.

---

## Section 3 — Code Duplication

### A08 · Subprocess spawn pattern duplicated 5 times · MEDIUM

The pattern of `spawn → capture stdout/stderr → start kill-timer → proc.on('close') / proc.on('error')` is reimplemented independently in:

| File                        | Function / inline use         | Timeout                |
| --------------------------- | ----------------------------- | ---------------------- |
| `src/server/api/render.ts`  | inline in `registerRenderApi` | 120 000 ms             |
| `src/server/api/exec.ts`    | `runSubprocess()`             | 30 000 ms              |
| `src/server/api/pandoc.ts`  | `runPandoc()`                 | 30 000 ms              |
| `src/server/api/preview.ts` | inline in `startPreview()`    | none (fire-and-forget) |
| `src/server/watcher.ts`     | inline in `handleChange()`    | none (fire-and-forget) |

Each copy re-implements the timer/kill race slightly differently (e.g. `render.ts` uses a `responded` guard while `pandoc.ts` uses `timedOut`). A bug fix in one copy must be replicated manually.

**Fix:** Add `src/server/utils/spawnCapture.ts`:

```ts
export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  notFound: boolean;
}
export function spawnCapture(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; stdin?: string; timeoutMs?: number }
): Promise<SpawnResult>;
```

All five callers reduce to a single `await spawnCapture(...)` call.

---

### A09 · `sanitizeError` and `sanitizeGitError` are identical · LOW

In `src/server/utils/errorSanitizer.ts` both functions share exactly the same two-regex body. The only distinction is the JSDoc comment.

**Fix:** Implement one in terms of the other, or collapse to a single `sanitizeError` export and remove `sanitizeGitError`:

```ts
export const sanitizeGitError = sanitizeError;
```

---

### A10 · Trivial re-aliasing in `links.ts` and `search.ts` · LOW

`src/server/api/links.ts`:

```ts
const extractTitle = getTitleWithFallback;
const extractTags = getTags;
```

`src/server/api/search.ts`:

```ts
function extractFrontMatterTitle(raw: string, fallback: string): string {
  return getTitleWithFallback(raw, fallback);
}
```

Both are one-line indirections that add noise without abstraction value.

**Fix:** Use the shared utility functions directly at their call sites.

---

## Section 4 — Client API Layer Coverage

`src/client/api/endpoints.ts` provides a canonical `API` constants object. Coverage is mostly good — most client modules (`git/index.ts`, `graph/index.ts`, `history/index.ts`) use `API.*` correctly. However:

### A11 · `main.ts` bypasses `endpoints.ts` with 8 raw `fetch()` strings · MEDIUM

| Line | Raw string used                 | Should use        |
| ---- | ------------------------------- | ----------------- |
| 136  | `'/api/git/commit'`             | `API.gitCommit`   |
| 163  | `'/api/git/commit'`             | `API.gitCommit`   |
| 348  | `'/api/pages'`                  | `API.pages`       |
| 367  | `'/api/directories'`            | `API.directories` |
| 394  | `` `/api/db/create?path=...` `` | `API.dbCreate`    |
| 418  | `` `/api/pages/${...}` ``       | `API.pages`       |
| 441  | `'/api/git/status'`             | `API.gitStatus`   |
| 523  | `` `/api/pages/${...}` ``       | `API.pages`       |

If any of these routes are renamed, the compiler cannot catch the stale strings in `main.ts`.

**Fix:** Replace all 8 occurrences with `API.*` references. Given `main.ts` will be split (see A01), this also becomes easier once the file is broken apart.

---

### A12 · `endpoints.ts` missing constants for two server routes · LOW

| Server route                     | HTTP method | Missing constant                                                |
| -------------------------------- | ----------- | --------------------------------------------------------------- |
| `/api/pages/{path}` rename       | `PATCH`     | `API.pagesRename` (or `API.pages` re-used with a clear comment) |
| `/api/directories/{path}` delete | `DELETE`    | `API.directoriesDelete`                                         |

`API.directories` currently only documents the `POST` (create) use case. The `DELETE /api/directories/*` route exists in the server but has no corresponding named constant.

**Fix:** Add `pagesRename` and `directoriesDelete` to the `API` object in `endpoints.ts`.

---

## Section 5 — Circular Dependencies

### A13 · `ServerContext` defined in entry-point `index.ts`, imported as type by all API modules · MEDIUM

```
index.ts  ──(runtime import)──►  api/pages.ts
                                  api/git.ts
                                  api/search.ts
                                  … (all 13 handler files)
     ▲
     └──(import type)────────────  api/pages.ts, api/git.ts, …
```

All 13 handler files carry `import type { ServerContext } from '../index.js'`. TypeScript erases type-only imports so there is no runtime circular dependency, but the design is conceptually inverted: the bootstrapping entry point is the authority for the context type that all its own dependencies rely on.

If `index.ts` is ever refactored (e.g. to separate `createApp` from `startServer`), all 13 handler files need updating.

**Fix:** Move `ServerContext` (and optionally `createApp`'s return type) to `src/server/config.ts` — it already owns `QuartostoneConfig` and `CommitMode`. Alternatively create `src/server/context.ts`:

```ts
// src/server/context.ts
import type { QuartostoneConfig } from './config.js';
export interface ServerContext {
  cwd: string;
  config: QuartostoneConfig;
  port: number;
  clientDist?: string;
}
```

`index.ts` imports from `context.ts`; handler files import from `context.ts`. No conceptual cycle.

---

## Section 6 — Build Config Issues

### A14 · `vite.config.ts`: dev-proxy port coupled to env var, mismatches silently · LOW

```ts
const serverPort = parseInt(process.env['QUARTOSTONE_PORT'] ?? '4242', 10);
// ...
proxy: {
  '/api': { target: `http://localhost:${serverPort}`, ... },
  '/ws':  { target: `ws://localhost:${serverPort}`, ... },
},
```

The server port is controlled by `_quartostone.yml` → `port:`. The Vite dev proxy reads from a _separate_ env var. If a developer changes the port in the YAML config and forgets to set `QUARTOSTONE_PORT`, the dev proxy silently points at the wrong port and all API calls return connection-refused errors with no obvious explanation.

**Fix:** Either read the port from `_quartostone.yml` in `vite.config.ts` (using the same `yaml` parser already in the project), or produce a clear error when the env var is absent:

```ts
if (!process.env['QUARTOSTONE_PORT']) {
  console.warn(
    '[vite] QUARTOSTONE_PORT not set; defaulting to 4242. Set it to match _quartostone.yml.'
  );
}
```

---

## Section 7 — Routes Registered Without a Handler File

### A15 · `GET /api/health` inlined in `createApp()` · LOW

```ts
// src/server/index.ts
app.get('/api/health', (_req, res) => res.json({ ok: true }));
```

This is the only route implemented directly in `index.ts` rather than delegated to a named handler module. It creates a minor asymmetry: all other route registrations are 13 separate `register*Api(app, ctx)` calls; this one is a one-liner inside `createApp`.

The health route is trivial today but could grow (e.g. checking git repo status, pages dir existence, quarto availability). A dedicated module keeps that growth contained.

**Fix:** Move to `src/server/api/health.ts` or, if it truly stays trivial, leave it inline but add a comment confirming the intentional exception.

---

## Section 8 — Dead Code

### A16 · `src/server/utils/asyncRoute.ts` — defined but never used · LOW

`asyncRoute()` was added to wrap async Express handlers and forward rejected promises to Express's error chain. It is never imported by any other file in the project. All server routes use inline `try/catch` or handle errors directly.

**Fix:** Remove the file, or adopt it consistently across all async route handlers.

---

## Recommended Fix Priority

| Priority   | IDs                                                                  | Effort                                                |
| ---------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| Do first   | A01 (god file split)                                                 | Large — but all other issues become easier after this |
| Do next    | A13 (move ServerContext), A08 (shared spawn util)                    | Medium — improves testability and DRY                 |
| Then       | A02–A06 (global state → class/instance), A11 (main.ts fetch strings) | Medium                                                |
| Small wins | A09, A10, A12, A15, A16                                              | < 1 hour each                                         |
| Monitor    | A07 (pandoc cache TTL), A14 (proxy port warning)                     | Low risk, low urgency                                 |
