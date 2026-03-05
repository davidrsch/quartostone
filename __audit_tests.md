# Test Coverage & Quality Audit — quartostone

**Scope:** All test files and source files under `f:\Projects\GitHub\quartostone\quartostone`
**Date:** 2025-07-22
**Methodology:** Complete manual review of all 34 Vitest test files (20 server unit, 11 client unit, 3 integration), all source files under `src/`, and the Vitest configuration. Playwright E2E tests noted but not audited in depth.

---

## Contents

1. [Untested Source Files](#1-untested-source-files)
2. [Weak Tests](#2-weak-tests)
3. [Missing Edge Cases per Test File](#3-missing-edge-cases-per-test-file)
4. [Test Quality Issues](#4-test-quality-issues)
5. [Untested API Routes](#5-untested-api-routes)
6. [Missing Error-Path Tests](#6-missing-error-path-tests)
7. [Vitest Configuration](#7-vitest-configuration)
8. [Test File Structure](#8-test-file-structure)
9. [Findings Summary & Priority](#9-findings-summary--priority)

---

## 1. Untested Source Files

Files with **no dedicated test file** and no meaningful indirect coverage.

### 1.1 Server — `src/server/`

#### `src/server/utils/frontmatter.ts` — **HIGH**

This file exports five functions used throughout the server: `parseFrontmatter`, `getTitle`, `getTitleWithFallback`, `getTags`, `getFrontmatterKey`. There is no dedicated test file. The functions appear indirectly via `db.test.ts` and `pages.test.ts`, but their own contract is never verified:

- `parseFrontmatter` — the `try/catch` branch for malformed YAML is never exercised in any test.
- `getTitle` — empty-string fallback not tested; `title` as a number not tested.
- `getTitleWithFallback` — the slug-to-title conversion path (when `title` is absent) is never tested.
- `getTags` — the `categories` key fallback is never tested; both `tags` and `categories` present simultaneously is never tested; non-array value for `tags` is never tested.
- `getFrontmatterKey` — generic key access is never tested.

#### `src/server/index.ts` — **MEDIUM** (partial)

`createApp` is exercised via supertest throughout the server unit tests, but the following aspects of `src/server/index.ts` are never exercised:

- `createServer()` — the HTTP `Server` wrapper is never called in any test; only the Express `app` is tested.
- CORS middleware — cross-origin requests are never sent in any test, so the origin-rejection branch and the `OPTIONS` preflight response are never exercised.
- Global 4-parameter error handler (`(err, req, res, next)`) — no test ever triggers it; it requires Express to call `next(err)`.
- Content-length limit (1 MB request body cap in production mode) is not verified.

#### `src/server/watcher.ts` — **LOW** (intentional)

Excluded from coverage in `vitest.config.ts` (`excludeFromCoverage`). The exclusion is justified given the chokidar dependency and live filesystem requirement. Noted for completeness.

---

### 1.2 Client — `src/client/`

The entire `src/client/` directory is **excluded from Vitest coverage tracking**. The following files have no unit test at all:

| File                             | Size/Complexity                                                       | Priority |
| -------------------------------- | --------------------------------------------------------------------- | -------- |
| `src/client/git/index.ts`        | Large: fetch wrappers for 13+ git routes, push/pull/merge/conflict UI | HIGH     |
| `src/client/branches/index.ts`   | Medium: branch creation, checkout, merge, conflict resolution UI      | HIGH     |
| `src/client/export/index.ts`     | Medium: export trigger, polling loop, format selection                | HIGH     |
| `src/client/search/index.ts`     | Medium: debounced search, result rendering                            | MEDIUM   |
| `src/client/backlinks/index.ts`  | Medium: DOM diffing, fetch loop                                       | MEDIUM   |
| `src/client/database/index.ts`   | Medium: field CRUD, schema rendering, inline cell editing             | MEDIUM   |
| `src/client/history/index.ts`    | Medium: git log rendering, file restore trigger                       | MEDIUM   |
| `src/client/graph/index.ts`      | Large: D3/force graph rendering, link data transform                  | MEDIUM   |
| `src/client/editor/runWidget.ts` | Medium: CodeMirror widget, subprocess result rendering                | MEDIUM   |
| `src/client/utils/toast.ts`      | Small: single DOM function                                            | LOW      |
| `src/client/api/endpoints.ts`    | Constants only                                                        | LOW      |

`src/client/editor/index.ts`, `src/client/sidebar/index.ts`, `src/client/tabbar/index.ts`, `src/client/preview/index.ts`, `src/client/properties/index.ts`, `src/client/treeNav/index.ts`, `src/client/cmdpalette/index.ts`, `src/client/theme/index.ts` all have test files but see Section 2 for quality notes.

---

### 1.3 CLI — `src/cli/`

No test file exists for any CLI module. The CLI is the user-facing entry point and contains significant logic.

#### `src/cli/commands/init.ts` — **HIGH**

Scaffolds a new quartostone workspace: creates `_quartostone.yml`, `_quarto.yml`, the pages directory, and a template `.qmd` file. None of this is tested. Key gaps:

- Directory-already-exists case (should error or offer to skip).
- Conflicting files case (e.g., `_quartostone.yml` already present).
- No git repository at target path.
- Non-writable target path.

#### `src/cli/commands/serve.ts` — **HIGH**

Loads config, resolves `cwd`, and calls `createServer`. Key gaps:

- Missing `_quartostone.yml` with `--no-config` flag behaviour.
- Port already in use → should print a friendly error.
- Config file with validation errors.

#### `src/cli/index.ts` — **LOW**

Commander wiring; very thin. Low independent test value.

---

### 1.4 Shared — `src/shared/`

| File                     | Risk                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| `src/shared/wikiLink.ts` | Two exported regex constants; extremely low value to test directly. |
| `src/shared/formats.ts`  | Format-string constants; no logic, no test value.                   |
| `src/shared/types.ts`    | TypeScript type declarations; not testable at runtime.              |

---

## 2. Weak Tests

Test files that exist but whose assertions are incomplete or cover only the trivial path.

### 2.1 `tests/unit/server/asyncRoute.test.ts`

**Test 3 — timing dependency.** The third test resolves a promise via `setTimeout(r, 10)` and then awaits it. Under heavy CPU load (slow CI runner) there is a race between the timer firing and the request completing. This is the classic flaky timing anti-pattern. The assertion should use a mock or synchronous resolution, not a real timer.

**Missing:** No test verifies that `next` is NOT called when the handler resolves normally (only `errorNext` is validated on the rejection path).

### 2.2 `tests/unit/server/exec.test.ts`

**Missing 403 path.** All tests pass a config with `allow_code_execution: true`. The guarding check `if (!ctx.config.allow_code_execution)` is never exercised. The 403 Forbidden response is never triggered. This is a security-relevant branch.

**Missing Julia language.** The `julia` case in the switch statement is never exercised. The `not found` path (`notFound: true` from ENOENT) is only tested for Python; R and Julia have the same path but are not verified.

**Missing timeout path.** The `timedOut: true` result (process killed after 30 s) is never tested. The kill logic is non-trivial and should be verified.

### 2.3 `tests/unit/server/pandoc.test.ts`

**All meaningful tests are conditionally skipped.** Every test that validates route behaviour uses `const it = skipIf(!pandocAvailable)`, meaning that on machines without pandoc installed — including most CI environments unless pandoc is pinned — all 15+ substantive tests silently pass as skipped. Only the "pandoc unavailable → 503" paths run unconditionally.

However, the `POST /api/pandoc/listExtensions` unavailable test is itself missing (there is a 503 test only for the main `/api/pandoc/convert` route, not for `listExtensions`, `getBibliography`, `addToBibliography`, or `citationHTML`).

### 2.4 `tests/unit/server/config.test.ts`

Tests cover `loadConfig` (YAML parsing) and `generateCommitSlug` well. But `validateConfig` — which applies five validation rules to the parsed config — is undertested:

- `pages_dir` resolving **outside** the project root: this path produces a warning and falls back to `'pages'`, but no test verifies the warning is emitted or the fallback used.
- `render_scope` with an invalid value (not `'page'` or `'project'`): falls back to `'page'`, never tested.
- Negative or zero `port` value: no test.
- `validateConfig` warning emission is never verified with a spy on `logWarn`.
- The `DEFAULTS` export shape is never asserted, only used indirectly.

### 2.5 `tests/unit/server/db.test.ts`

Tests cover `parseDbFile` and `serialiseDbFile` for round-trip correctness. Missing:

- **Unknown field type fallback** — `normaliseSchema` maps unknown types to `'text'`; this branch is never tested.
- **`normaliseSchema` id-as-name fallback** — when a field is missing `name`, the `id` is used as the display name; never tested.
- **Select field with no `options` array** — select field without options should not crash serialisation; never tested.
- **Field IDs with spaces** — IDs should be normalised to underscores; never tested.
- **Pipe characters in cell content** — markdown table cell that contains `|` should be escaped; never tested.
- **Empty schema array** — a page with `schema: []` should serialise to a file with no table; never tested.

### 2.6 `tests/unit/server/qmdFiles.test.ts`

- **Symlinks** inside the pages directory are never tested (should they be followed or ignored?).
- **Hidden files** (dotfiles, e.g., `.hidden.qmd`) — not collected, never tested.
- **Directory with deeply nested `.qmd` files** (3+ levels) — not tested.

### 2.7 `tests/unit/server/search.test.ts`

- `updateSearchIndexForFile` and `removeSearchIndexForFile` are imported in the module but **never called directly in any test**; they are only invoked indirectly by the watcher (excluded from tests). Their correctness relative to the in-memory `index` Map is therefore untested.
- `POST /api/search/reindex` route — see Section 5.

### 2.8 `tests/unit/server/links.test.ts`

- `updateLinkIndexForFile` and `removeLinkIndexForFile` are imported in the module but **never called directly in any test**. Only the initial `buildLinksIndex` path is ever exercised via the `beforeEach` rebuild.
- Link index mutation functions are load-bearing for the watcher; their absence from tests means stale-link bugs would not be caught.

### 2.9 `tests/unit/client/*.test.ts` (general)

Client tests use `happy-dom` but exercise only surface DOM manipulation. None of them mock `fetch` and verify that the correct API endpoint is called with the correct body. Tests assert that UI elements exist but do not assert that the underlying API contract is upheld.

---

## 3. Missing Edge Cases per Test File

### 3.1 `tests/unit/server/git.test.ts`

- `POST /api/git/commit` with `message.length > 4096` → should return 400; never tested (the 4096-char guard exists in source).
- `GET /api/git/diff` with an invalid SHA format → should return 400 (`Invalid SHA format`); never tested.
- `POST /api/git/checkout` when stash-pop produces a conflict → should return `{ ok: true, stashConflict: true }`; the source has this path but no test covers it.
- `POST /api/git/merge` resulting in a 409 conflict response → tested for the success case only; the `result.failed` branch and the catch exception branch are both untested.
- `GET /api/git/log` with `?path=` filter that matches nothing → should return `[]`; not tested.
- `POST /api/git/branches` with an invalid branch name (e.g., name with spaces) → 400; tested only for empty name.

### 3.2 `tests/unit/server/pages.test.ts`

- `PATCH /api/pages` rename where `newPath` already has a `.qmd` extension supplied by the client — should not double-append or should normalise; never tested.
- `PUT /api/pages/:path` with content exactly at or above the 1 MB body size limit.
- `DELETE /api/pages/:path` on a path that is a **directory** (not a file) — should the API delete recursively or reject?
- `GET /api/pages` tree with **3 or more levels** of nesting (only 1–2-level tests exist).
- `POST /api/pages` where the parent directory does not exist yet — `mkdirSync` is called; never tested for deep missing ancestors.
- `GET /api/pages/:path` for a file that exists as a file in the OS but was created empty — should return `{ content: '' }`; never tested.

### 3.3 `tests/unit/server/links.test.ts`

- Wiki link with anchor section `[[Target#section]]` — should the link still resolve to `Target.qmd`? The `#section` part should be stripped for back-link tracking; never tested.
- Wiki link with display text `[[Target|display]]` — should link to `Target`, displaying `display`; never tested.
- Link to a page that **does not exist** (dangling link) — backlink index entry for a non-existent page; never tested.
- A page with **duplicate links** to the same target — should appear only once in the forward-link list; never tested.
- `GET /api/links/graph` with an isolated page (not connected to anything) — should appear as a node with no edges; never tested.
- `GET /api/links/search` with a query that matches no pages — should return `[]`; covered nominally but not for empty results.

### 3.4 `tests/unit/server/xref.test.ts`

- `walkFiles` is exported from the module but never called directly in tests; it is exercised only indirectly through `scanXRefsInProject`.
- Equation blocks (`#eq-` prefix) as XRef targets — only figure (`#fig-`) and table (`#tbl-`) prefixes appear in tests.
- XRef cache invalidation via `markXRefCacheDirty` — the function is exported and used by the watcher but never tested directly.
- `GET /api/xref/for-id` with an ID that exists in the cache vs one that forces a fresh scan — cache hit/miss distinction is untested.
- `POST /api/xref/index` with `forceRefresh: true` — never tested.

### 3.5 `tests/unit/server/export.test.ts`

- `GET /api/export/formats` — never tested (see Section 5).
- `GET /api/export/download/:token` — never tested (see Section 5).
- Export spawn ENOENT (quarto not on PATH) — `notFound` error path; never tested.
- After a successful export, the expected output file is absent (quarto exits 0 but writes no file) — `writeOutputFile` fallback; never tested.
- Export `GET /api/export/status/:token` transition through `'running'` state — the current tests poll directly for completion; intermediate `running` state is not asserted.

### 3.6 `tests/unit/server/render.test.ts`

- `render_scope: 'project'` — when a `path` is also supplied, the path should be ignored (project-level render). Never tested.
- Quarto ENOENT — quarto binary not found; the `notFound` path is not tested for the render subprocess.

### 3.7 `tests/unit/server/preview.test.ts`

- `POST /api/preview/start` is tested with a mock spawn. But `GET /api/preview/ready`, `GET /api/preview/status`, and `GET /api/preview/logs` routes are all untested (see Section 5).
- `POST /api/preview/stop` route — not tested.
- Quarto ENOENT during start — not tested.

### 3.8 `tests/unit/server/trash.test.ts`

- `POST /api/trash/restore` when the restore destination already exists — should error or overwrite; never tested.
- `GET /api/trash` filtering — all trashed files are returned; filtering by name/date is not tested (if supported).
- Trashing a file that is a symlink — never tested.

### 3.9 `tests/unit/server/assets.test.ts`

- Upload of an SVG file that contains `<script>` tags — the server should either refuse it or strip the script; never tested (security-relevant).
- Upload of a file with a path-traversal name (`../evil.png`) in the multipart `filename` field — never tested.
- `GET /assets/:file` for a non-existent file — should 404; never tested.
- Multiple files in the same upload request — never tested.

### 3.10 `tests/unit/server/errorSanitizer.test.ts`

- **Windows-style absolute paths** in `sanitizeGitError` output — the regex `/\/(home|tmp|var|root|Users?)\/[^\s:,'"]+/g` uses POSIX path prefixes and would not match Windows paths like `C:\Users\alice\repo`; never tested.
- **Multiple file paths** in a single error message — only single-path sanitisation is tested.
- **Stack trace path stripping** — `at Object. (C:\path\to\server\index.js:10:5)` style; only one variant tested.

### 3.11 `tests/unit/server/pathGuard.test.ts`

- `isInsideDir` with a **Windows-style backslash path** (`pages\sub\file.qmd`) — cross-platform behaviour is unverified.
- **Null or undefined** input to `resolveInsideDir` — should throw `PathTraversalError` with a clear message; never tested.
- A path that resolves to the pages directory **root itself** (not inside) — boundary condition; never tested.

### 3.12 `tests/integration/git-branches.test.ts`

- Branch checkout when there are **unstaged changes** — the stash/pop autostash path; not tested in integration.
- Branch deletion of the **currently checked-out** branch — should fail with a descriptive error; not tested.
- Merge conflict scenario in integration — the 409 response with `conflicts` array; not tested.

---

## 4. Test Quality Issues

### 4.1 Timing-based assertion in `asyncRoute.test.ts`

```
await new Promise(r => setTimeout(r, 10));
```

Real timer sleeps in tests are a well-known source of intermittent failures under CI load. This test does not need a real timer; a synchronous rejection via `Promise.reject()` would be sufficient.

### 4.2 Platform-dependent test in `pathGuard.test.ts`

The test "treats a POSIX absolute path as a relative segment inside root" passes `/etc/passwd` as input. On Linux/macOS, `resolve(join(root, '/etc/passwd'))` behaves one way; on Windows it behaves differently because POSIX absolute paths are not absolute on Windows. This test silently changes semantics across platforms.

### 4.3 Shared module-level Map state

`links.test.ts` and `search.test.ts` both import modules that maintain module-level `Map` singletons (`forwardLinks`, `backlinks`, `index`). Tests call `.clear()` in `beforeEach`/`afterEach` to prevent bleed between tests. This is fragile: any test that forgets a `clear`, or any new test that is added without the boilerplate, can corrupt subsequent tests. The state should be encapsulated or the module should be re-imported freshly per test (using `vi.resetModules()`).

### 4.4 Order-dependent integration tests in `git-branches.test.ts`

The integration test file shares a single `client` object and a single git repository across multiple `describe` blocks. The first `describe` creates and switches to a new branch. The second `describe` assumes the repository is still on that branch. The third `describe` (show/restore) assumes a commit made in the first block is still visible. If any test in a prior block fails or is skipped, subsequent blocks break in confusing ways. Each `describe` should either set up its own independent state or explicitly reset to a known base state in `beforeEach`.

### 4.5 `extra-coverage.test.ts` as a coverage-debt workaround

The file is named and structured explicitly to boost coverage of branches that are not reachable via the normal happy-path unit tests. While the tests themselves are valid, the organization:

- Is hard to discover when debugging a failing test (the test subject is opaque from the file name).
- Groups unrelated behaviours (malformed YAML config, path traversal in db, health endpoint, static site serving) into a single file.
- Implies that the normal unit-test files have significant untested branches, which is a design smell rather than a solution.

### 4.6 Client tests do not verify API contracts

All 11 client unit tests (`breadcrumb.test.ts`, `cmdpalette.test.ts`, etc.) test DOM mutations using `happy-dom`. None of them mock `fetch` and assert that:

- The correct URL was called.
- The correct request body was sent.
- Different HTTP response statuses produce the correct UI outcome (loading, error, success states).

This means client-server API contract changes would not be caught by any test.

### 4.7 No assertion on response headers in server tests

No server unit test asserts `Content-Type: application/json`, cache headers, or CORS headers. A misconfiguration in middleware that removes or corrupts these headers would not be detected.

### 4.8 `export.test.ts` — status polling polls with real `setInterval`

The export status-polling test uses real `setInterval` via supertest and awaits completion. This is slow and time-coupled. If the export subprocess (mocked in tests) completes unusually fast or slow for timing reasons, the test may report inconsistent states.

---

## 5. Untested API Routes

Routes that exist in the server source but are exercised by **zero Vitest tests** (unit or integration).

### 5.1 `src/server/api/git.ts` — remote and merge-resolution routes

All seven of these routes are in the source but have no corresponding unit or integration test:

| Route                          | Description                                                   |
| ------------------------------ | ------------------------------------------------------------- |
| `GET /api/git/remote`          | Returns remote URL, tracking branch, ahead/behind counts      |
| `POST /api/git/push`           | Pushes to `origin` with a 30 s timeout                        |
| `POST /api/git/pull`           | Pulls from `origin` with `--ff-only`; returns 409 if diverged |
| `PATCH /api/git/remote`        | Validates and sets/adds the `origin` remote URL               |
| `POST /api/git/merge-abort`    | Aborts an in-progress merge (`git merge --abort`)             |
| `GET /api/git/conflicts`       | Lists conflicted files from `git status`                      |
| `POST /api/git/merge-complete` | Stages all and commits after manual conflict resolution       |

Notable for `PATCH /api/git/remote`: there is a URL-validation block that disallows `file://` protocol and validates URL scheme. This security-relevant validation is completely untested — an invalid URL, a `file://` URL, and a valid URL should each be tested.

### 5.2 `src/server/api/export.ts`

| Route                             | Description                                                |
| --------------------------------- | ---------------------------------------------------------- |
| `GET /api/export/formats`         | Returns list of supported export output formats            |
| `GET /api/export/download/:token` | Streams the exported file to the client; cleans up on send |

`GET /api/export/status/:token` is partially tested (final state) but intermediate states are not.

### 5.3 `src/server/api/preview.ts`

| Route                     | Description                                                    |
| ------------------------- | -------------------------------------------------------------- |
| `GET /api/preview/ready`  | Returns `{ ready: boolean, port: number \| null }`             |
| `GET /api/preview/status` | Returns current preview process status and port                |
| `GET /api/preview/logs`   | Returns buffered stdout/stderr from the quarto preview process |
| `POST /api/preview/stop`  | Kills the quarto preview subprocess                            |

### 5.4 `src/server/api/search.ts`

| Route                      | Description                                                |
| -------------------------- | ---------------------------------------------------------- |
| `POST /api/search/reindex` | Clears the search index and rebuilds from all `.qmd` files |

### 5.5 `src/server/api/pandoc.ts` — conditionally skipped routes

The following routes are tested only via `skipIf(!pandocAvailable)`, meaning they are silently omitted on any system without pandoc. They are not tested using mock-based approaches that would run unconditionally:

| Route                                |
| ------------------------------------ |
| `POST /api/pandoc/listExtensions`    |
| `POST /api/pandoc/getBibliography`   |
| `POST /api/pandoc/addToBibliography` |
| `POST /api/pandoc/citationHTML`      |

Additionally, the 503 "pandoc unavailable" response for `listExtensions`, `getBibliography`, `addToBibliography`, and `citationHTML` is never tested — only the 503 for the primary `/api/pandoc/convert` route has an unconditional test.

---

## 6. Missing Error-Path Tests

The following error branches exist in the source and are exercised by zero tests.

### 6.1 `src/server/utils/frontmatter.ts` — `parseFrontmatter` catch branch

`parseFrontmatter` wraps `yaml.parse` in a try/catch and returns an empty `{}` meta object on failure. No test provides malformed YAML to this function directly. The catch is exercised only partially via `extra-coverage.test.ts` through the config-loading path, not through the frontmatter utility itself.

### 6.2 `src/server/index.ts` — global Express error handler

The 4-parameter middleware `(err, req, res, next)` at the bottom of `createApp` is never triggered in tests. The only way to reach it is for a route handler to call `next(err)` with an argument, or throw synchronously outside of an `asyncRoute` wrapper. Its JSON error response shape is unverified.

### 6.3 `src/server/api/exec.ts` — `allow_code_execution: false`

The guard at the top of `POST /api/exec` returns 403 when code execution is disabled. All exec tests hard-code `allow_code_execution: true` in their test config. The 403 path is never triggered.

### 6.4 `src/server/api/exec.ts` — ENOENT for R and Julia

The "binary not found" (`notFound: true`) error path is only tested for Python (`python`/`python3` both ENOENT). The R (`Rscript`) and Julia (`julia`) ENOENT paths follow the same code but are not tested.

### 6.5 `src/server/api/git.ts` — push/pull/remote network failures

The push/pull/remote routes all have `catch` blocks that call `sanitizeGitError`. They are never invoked in tests, so:

- The 409 "cannot fast-forward" path in `POST /api/git/pull` is never tested.
- The `file://` URL rejection in `PATCH /api/git/remote` is never tested.
- The invalid-URL rejection (malformed URL) in `PATCH /api/git/remote` is never tested.

### 6.6 `src/server/api/db.ts` — write failure

`PUT /api/db/:path` calls `writeFileSync`. No test simulates a write failure (e.g., disk full, permission denied). The `try/catch` around the write is therefore never exercised.

### 6.7 `src/server/api/pages.ts` — `mkdirSync` failure

`POST /api/pages` calls `mkdirSync({ recursive: true })`. No test verifies the behaviour when the filesystem rejects this call (permission error, read-only mount).

### 6.8 `src/server/api/export.ts` — spawn error event and missing output file

The `'error'` event on the spawned quarto process (ENOENT) is handled but not tested. Additionally, the case where quarto exits 0 but writes no output file to the expected location is handled but not tested.

### 6.9 `src/server/api/render.ts` — render scope: project with path ignored

`render_scope: 'project'` renders the whole project and ignores the `path` parameter. The config branch that ignores an incoming path in project-scope mode is never tested.

### 6.10 `src/server/config.ts` — `validateConfig` warning paths

`validateConfig` emits five possible `logWarn` calls for invalid user configuration. No test spies on `logWarn` to verify these warnings are emitted or to verify the fallback values applied. Specifically:

- `pages_dir` outside project root → warns and reverts to `'pages'`.
- `render_scope` invalid value → warns and reverts to `'page'`.
- `port` negative or zero → warns and reverts to `4242`.

---

## 7. Vitest Configuration

File: `vitest.config.ts` (no `vitest.workspace.ts` exists in this project).

### 7.1 Client coverage excluded entirely

```ts
include: ['src/server/**/*.ts'],
```

`src/client/` is not included in coverage tracking. The 11 client unit test files run, but their coverage contributes nothing to the thresholds. The practical result is that all client code can be deleted and the coverage report would not change. Coverage thresholds only express server-side quality.

### 7.2 Branch threshold significantly below line/function thresholds

```ts
thresholds: { lines: 85, functions: 86, statements: 84, branches: 70 }
```

The branch threshold (70%) is 15–16 points below the line (85%) and function (86%) thresholds. This gap exists because many `catch` branches, guard clauses, and optional-chain fallbacks are not exercised in happy-path tests. A 70% branch threshold allows up to 30% of error-handling branches to be untested before the CI check fails. This should be raised incrementally as the gaps in Section 6 are addressed.

### 7.3 Three files excluded from coverage without documentation

```ts
exclude: [
  '**/.coverage/**',
  'src/server/watcher.ts',
  'src/server/api/render.ts',
  'src/server/api/preview.ts',
],
```

The rationale for excluding `watcher.ts`, `render.ts`, and `preview.ts` is not documented in the config or in `README.md`. Someone maintaining the coverage config has no explanation for why these three files are special. A comment should be added.

### 7.4 No concurrency configuration while shared module-state exists

The config does not set `pool`, `poolOptions`, `maxWorkers`, or `sequence.concurrent`. Tests run in the default parallel mode. This is safe for the majority of test files, but `links.test.ts`, `search.test.ts`, and `xref.test.ts` all share module-level `Map` singletons that are reset via `beforeEach`. If two test files that import and modify the same Map singleton are run concurrently in the same worker, the state is not isolated. The current test count keeps these in separate worker threads by chance, but this is fragile.

### 7.5 No custom test reporter

The `reporters` key is only set for coverage output (`['text', 'lcov', 'html']`). There is no JSON or JUnit reporter configured for CI test result upload. CI pipelines typically benefit from a machine-readable test result format.

---

## 8. Test File Structure

### 8.1 Mixed pure-function and HTTP-route tests in the same file

`links.test.ts`, `search.test.ts`, and `xref.test.ts` each test both pure utility functions and HTTP routes in the same file. This is workable but makes it harder to identify what is a unit test (no I/O) versus a route integration test (real app + supertest). Separating them would clarify the surface area and allow pure-function tests to run faster without app setup.

### 8.2 `extra-coverage.test.ts` — structural debt

This file accumulates tests for branches that were missed in earlier test files. Its name signals that coverage is the motivation rather than behaviour. The tests inside are valid, but they belong in the files where the relevant components are already being tested (`config.test.ts`, `db.test.ts`, `git.test.ts`, `links.test.ts`). Keeping them here makes the test suite harder to navigate and disguises the true gap in each component's test file.

### 8.3 `git-branches.test.ts` — implicit state ordering between `describe` blocks

The three `describe` blocks in `git-branches.test.ts` share a single git repository and `BrowserTestClient`. The second block (show/restore) depends on commits made in the first block. No `beforeEach` at the describe level resets to a known state. This pattern causes confusing cascading failures if an individual test mid-file fails.

### 8.4 Integration vs. unit test overlap

`tests/integration/server.test.ts` tests `/api/pages/*` and `/api/db/*` routes that are also fully covered by `tests/unit/server/pages.test.ts` and `tests/unit/server/db.test.ts`. The integration tests add value for end-to-end smoke testing but the overlap is unacknowledged, and the integration tests are weaker (fewer assertions) than the unit tests. This overlap is acceptable intentionally but should be documented.

### 8.5 No test for the `GET /api/health` endpoint in unit tests

The health endpoint (`GET /api/health`) is only tested in `tests/integration/extra-coverage.test.ts`. It is not tested in any unit test file. If the endpoint were accidentally removed from `src/server/index.ts`, no unit test would catch it.

### 8.6 Playwright E2E tests are not integrated with Vitest

The Playwright tests in `tests/e2e/` are run with a separate `playwright test` command and are not part of the Vitest run. The `vitest.config.ts` does not reference them. There is no mechanism in the standard `npm test` script to run both suites and report a combined result. Documentation on which tests require a running server and how to run the full test suite is absent from `README.md`.

---

## 9. Findings Summary & Priority

### Critical (would mask real bugs or security regression)

| #   | Finding                                                                                                     | Location         |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------- |
| C1  | `POST /api/exec` — 403 path when `allow_code_execution: false` is never tested                              | `exec.test.ts`   |
| C2  | `PATCH /api/git/remote` — URL validation (file:// rejection, invalid URL) entirely untested                 | `git.test.ts`    |
| C3  | `src/server/utils/frontmatter.ts` — no test file; malformed-YAML catch branch unverified                    | missing          |
| C4  | `updateLinkIndexForFile` / `removeLinkIndexForFile` never called in tests — stale link bugs invisible       | `links.test.ts`  |
| C5  | `updateSearchIndexForFile` / `removeSearchIndexForFile` never called in tests — stale search bugs invisible | `search.test.ts` |

### High (significant coverage or correctness gap)

| #   | Finding                                                                              | Location           |
| --- | ------------------------------------------------------------------------------------ | ------------------ |
| H1  | All 7 git remote/push/pull/merge-resolution routes — zero tests                      | `git.test.ts`      |
| H2  | CLI `init` and `serve` commands — no test file                                       | missing            |
| H3  | `POST /api/git/merge` — 409 conflict response path never tested                      | `git.test.ts`      |
| H4  | `POST /api/git/checkout` — `stashConflict: true` path never tested                   | `git.test.ts`      |
| H5  | All `preview` sub-routes except start — zero tests                                   | `preview.test.ts`  |
| H6  | `export.ts` — formats and download routes entirely untested                          | `export.test.ts`   |
| H7  | `search.ts` — `POST /api/search/reindex` entirely untested                           | `search.test.ts`   |
| H8  | `db.ts` — `normaliseSchema` unknown-type and edge cases not tested                   | `db.test.ts`       |
| H9  | Branch threshold (70%) 15+ points below line threshold — hides uncovered error paths | `vitest.config.ts` |
| H10 | Client code entirely excluded from coverage (no threshold, no include)               | `vitest.config.ts` |

### Medium (quality / maintainability)

| #   | Finding                                                                                        | Location                          |
| --- | ---------------------------------------------------------------------------------------------- | --------------------------------- |
| M1  | All pandoc routes silently skip on systems without pandoc; unavailable-503 tests incomplete    | `pandoc.test.ts`                  |
| M2  | `validateConfig` warning paths not tested; no spy on `logWarn`                                 | `config.test.ts`                  |
| M3  | `asyncRoute.test.ts` test 3 — real timer sleep, flaky under load                               | `asyncRoute.test.ts`              |
| M4  | `pathGuard.test.ts` — POSIX absolute-path test is platform-dependent                           | `pathGuard.test.ts`               |
| M5  | `git-branches.test.ts` — implicit cross-describe state ordering                                | `git-branches.test.ts`            |
| M6  | Shared module-level `Map` state (`forwardLinks`, `index`) reset only via `beforeEach`; fragile | `links.test.ts`, `search.test.ts` |
| M7  | Client tests assert DOM state but never mock `fetch` to verify API contracts                   | `tests/unit/client/`              |
| M8  | `extra-coverage.test.ts` — coverage-debt workaround; tests belong in their respective files    | `extra-coverage.test.ts`          |
| M9  | Global Express error handler never triggered in any test                                       | `server/index.ts`                 |
| M10 | Assets SVG upload with embedded `<script>` — no test verifies server-side handling             | `assets.test.ts`                  |

### Low (minor gaps)

| #   | Finding                                                                                 | Location                 |
| --- | --------------------------------------------------------------------------------------- | ------------------------ |
| L1  | `exec.test.ts` — Julia language and R/Julia ENOENT paths not tested                     | `exec.test.ts`           |
| L2  | Coverage excludes not documented in config                                              | `vitest.config.ts`       |
| L3  | No JSON/JUnit reporter configured for CI consumption                                    | `vitest.config.ts`       |
| L4  | `src/client/utils/toast.ts`, `src/shared/wikiLink.ts`, `src/shared/formats.ts` untested | missing                  |
| L5  | `errorSanitizer.test.ts` — Windows paths not covered                                    | `errorSanitizer.test.ts` |
| L6  | No unit test for `GET /api/health`                                                      | `server/index.ts`        |
| L7  | Playwright E2E not integrated with `npm test`; no documentation on full test run        | `tests/e2e/`             |
| L8  | No response-header assertions in any server test                                        | all server unit tests    |

---

_End of audit._
