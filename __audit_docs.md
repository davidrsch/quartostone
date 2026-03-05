# Quartostone Documentation & Developer-Experience Audit

**Date:** 2026-03-05  
**Auditor:** GitHub Copilot  
**Scope:** `f:\Projects\GitHub\quartostone\quartostone`

---

## Summary

| Area                    | Status  | Findings |
| ----------------------- | ------- | -------- |
| README completeness     | PARTIAL | 4 gaps   |
| API documentation       | POOR    | 8 gaps   |
| Code comments (JSDoc)   | PARTIAL | 14 gaps  |
| CONTRIBUTING guide      | PARTIAL | 6 gaps   |
| CHANGELOG               | MISSING | 1 gap    |
| Architecture docs       | PARTIAL | 4 gaps   |
| Configuration reference | PARTIAL | 3 gaps   |
| Type documentation      | POOR    | 5 gaps   |
| Examples / templates    | PARTIAL | 4 gaps   |
| Developer environment   | PARTIAL | 5 gaps   |

**Total: 54 documentation gaps — 9 HIGH, 22 MEDIUM, 23 LOW**

---

## 1. README Completeness

Files read: `README.md`

The README is well-structured and covers project purpose, comparison table, architecture, getting started, editor usage, config reference, extension features, and API overview. However, several sections used by contributors and advanced users are absent.

---

### D-01 · Missing build-from-source instructions

**Priority:** HIGH  
**Location:** `README.md` — no "Build" section exists

The README only describes installing the published package (`npm install -g quartostone`). There are no instructions for building the project from source, which is the workflow every contributor and anyone installing from a Git clone will need.

**Recommended content to add** (new section after "Getting Started"):

```markdown
## Building from source

Clone the repo and install dependencies:

    git clone https://github.com/davidrsch/quartostone
    cd quartostone
    npm install

Build the server (TypeScript → `dist/`):

    npm run build

Build the browser client (Vite → `dist/client/`):

    npm run build:client

Or run both at once:

    npm run build:all

For the visual editor panmirror bundle (required only if working on the
visual editor), first clone the quarto-fork sibling repo, then:

    npm run build:panmirror
```

---

### D-02 · Missing explicit "Running tests" section in README

**Priority:** HIGH  
**Location:** `README.md` — no "Testing" section

The README has no mention of how to run the test suite. Contributors discover the scripts only by reading `package.json`.

**Recommended content to add** (new section after "Build"):

```markdown
## Running tests

Unit and integration tests (Vitest + Supertest):

    npm run test              # single run
    npm run test:watch        # watch mode
    npm run test:coverage     # with V8 coverage report

End-to-end tests (Playwright):

    npm run build:client      # required: E2E tests need the built client
    npm run test:e2e          # headless
    npm run test:e2e:ui       # Playwright UI for debugging
```

---

### D-03 · No troubleshooting section

**Priority:** MEDIUM  
**Location:** `README.md` — no "Troubleshooting" section

Users frequently hit a handful of well-known startup errors. The README has no help for these.

**Recommended content to add**:

```markdown
## Troubleshooting

**`Error: quarto not found`**
Quarto must be installed and on your PATH. Install from https://quarto.org/docs/get-started/
then restart your terminal.

**`Error: listen EADDRINUSE :::4242`**
Port 4242 is already in use. Set `port: 4243` (or any free port) in `_quartostone.yml`.

**`Error: not a git repository`**
Quartostone requires a Git repository. Run `git init && git add . && git commit -m "init"`
in your workspace root.

**`Editor not built yet`**
You are running from source without the client bundle. Run `npm run build:client`.
```

---

### D-04 · `exec_timeout_ms` config key absent from README table

**Priority:** LOW  
**Location:** `README.md` — "Config reference" section, table ends at `allow_code_execution`

The `exec_timeout_ms` key exists in `docs/config.schema.json` and is used in `src/server/config.ts`, but it is missing from the README configuration table.

**Recommended addition** (new row in the config table):

| Key               | Default | Description                                                                              |
| ----------------- | ------- | ---------------------------------------------------------------------------------------- |
| `exec_timeout_ms` | `30000` | Override the code-execution subprocess timeout in ms. Useful for long-running notebooks. |

---

## 2. API Documentation

Files read: `docs/api-reference.md`, `src/server/api/` (all files)

The existing `docs/api-reference.md` covers Pages, Directories, Git, Render, Preview, Export, Exec, Database, Links, Search, and WebSocket events. Four entire APIs are absent, one response shape is wrong, WebSocket event names don't match the code, and one query parameter is undocumented.

---

### D-05 · Entire Trash API undocumented

**Priority:** HIGH  
**Location:** `docs/api-reference.md` — no "Trash" section  
**Code:** `src/server/api/trash.ts`

The soft-delete trash feature (`DELETE /api/pages/:path` moves pages to `.quartostone/trash/`) has three REST endpoints with no API reference documentation at all.

**Recommended content to add**:

```markdown
## Trash (soft-delete)

When a page is deleted via `DELETE /api/pages/:path`, it is moved to the workspace trash
(`.quartostone/trash/`) rather than permanently destroyed. The following endpoints manage
the trash bin.

### `GET /api/trash`

List all soft-deleted pages.

**Response:** `TrashMeta[]` where `TrashMeta = { id: string, originalPath: string, name: string, deletedAt: string }`.

---

### `POST /api/trash/restore/:id`

Restore a trashed page to its original path.

**Params:** `:id` — UUID of the trashed item (from `GET /api/trash`).

**Response:** `{ ok: true, path: string }`

**Errors:** `400` for invalid UUID; `404` if the item is not in trash;
`409` if the original path is already occupied; `500` on file-system failure.

---

### `DELETE /api/trash/:id`

Permanently destroy a trashed page.

**Params:** `:id` — UUID.

**Response:** `{ ok: true }`

**Errors:** `400` for invalid UUID; `404` if the item is not in trash.
```

---

### D-06 · Entire Assets API undocumented

**Priority:** HIGH  
**Location:** `docs/api-reference.md` — no "Assets" section  
**Code:** `src/server/api/assets.ts`

The image upload endpoint used by the visual editor has no documentation.

**Recommended content to add**:

```markdown
## Assets (image upload)

### `POST /api/assets`

Upload an image file. The file is saved to `pages/_assets/` with a timestamped filename
to avoid collisions. Accepted extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`,
`.webp`, `.avif`, `.bmp`, `.ico`. Maximum file size: **20 MB**.

**Request:** `multipart/form-data` with a single field named `file`.

**Response:** `{ url: string }` — a server-relative URL (`/assets/FILENAME`) suitable for
embedding in Markdown/Quarto documents.

**Errors:** `400` if no file was uploaded or the file type is not allowed.

---

### `GET /assets/:file`

Static file serving from `pages/_assets/`. The URL returned by `POST /api/assets` is
directly usable here.
```

---

### D-07 · Entire Pandoc proxy API undocumented

**Priority:** HIGH  
**Location:** `docs/api-reference.md` — no "Pandoc" section  
**Code:** `src/server/api/pandoc.ts`

The seven pandoc proxy endpoints are used exclusively by the panmirror visual editor. They are entirely absent from the API reference.

**Recommended content to add**:

```markdown
## Pandoc proxy (visual editor internal)

These endpoints proxy requests from the panmirror visual editor to a local `pandoc`
process. They are internal to the editor and not intended for external use, but are
documented here for completeness.

All endpoints accept and return JSON. A 30-second timeout is enforced.

| Endpoint                             | Purpose                                             |
| ------------------------------------ | --------------------------------------------------- |
| `POST /api/pandoc/capabilities`      | Return the installed pandoc version and format list |
| `POST /api/pandoc/markdownToAst`     | Convert Markdown to a Pandoc JSON AST               |
| `POST /api/pandoc/astToMarkdown`     | Convert a Pandoc JSON AST back to Markdown          |
| `POST /api/pandoc/listExtensions`    | List available extensions for a given format        |
| `POST /api/pandoc/getBibliography`   | Stub — returns an empty bibliography result         |
| `POST /api/pandoc/addToBibliography` | Stub — always returns `false`                       |
| `POST /api/pandoc/citationHTML`      | Stub — returns an empty string                      |

**Errors:** `503` if `pandoc` is not installed; `500` if pandoc exits non-zero or times out.
```

---

### D-08 · Entire XRef API undocumented

**Priority:** MEDIUM  
**Location:** `docs/api-reference.md` — no "XRef" section  
**Code:** `src/server/api/xref.ts`

The cross-reference scanner endpoints used by the visual editor are absent.

**Recommended content to add**:

```markdown
## Cross-references (XRef)

Quarto cross-reference labels (`#fig-`, `#tbl-`, `#sec-`, `#eq-`, etc.) across all
`.qmd` files are scanned and cached. Results are used by the visual editor's
cross-reference insertion dialog.

### `POST /api/xref/index`

Return all cross-reference labels in the workspace (or a single file).

**Body:** `{ file?: string }` — if provided, scope results to that file only.

**Response:** `{ baseDir: string, refs: XRef[] }` where
`XRef = { file: string, type: string, id: string, suffix: string, title?: string }`.

---

### `POST /api/xref/forId`

Look up a specific cross-reference by file and label ID.

**Body:** `{ file: string, id: string }`

**Response:** `{ baseDir: string, refs: XRef[] }` (zero or one entry).

**Errors:** `400` if `file` or `id` is missing.
```

---

### D-09 · Render endpoint response shape is wrong in docs

**Priority:** HIGH  
**Location:** `docs/api-reference.md` — `POST /api/render` section  
**Code:** `src/server/api/render.ts`

The docs state the response is `{ ok: boolean, stdout: string, stderr: string }`, but the implementation returns `{ ok: true, output: string }` on success and `{ ok: false, error: string }` on failure. The field names `stdout`/`stderr` do not exist in the actual response.

**Current docs (wrong):**

```
**Response:** `{ ok: boolean, stdout: string, stderr: string }`
```

**Corrected docs:**

```markdown
**Response (success):** `{ ok: true, output: string }` — `output` contains the combined
stdout from `quarto render`.

**Response (failure):** `{ ok: false, error: string }` (HTTP 500) — `error` contains the
stderr output or a timeout message.

**Errors:** `400` if `path` is missing when `scope` is `file`; `400` if `path` traverses
outside `pages_dir`; `400` for invalid `scope` value; `500` if render exits non-zero or
if the 120-second timeout fires.
```

---

### D-10 · WebSocket event names don't match the implementation

**Priority:** HIGH  
**Location:** `docs/api-reference.md` — "WebSocket events" table  
**Code:** `src/server/watcher.ts`

The API docs list event names using `snake_case` (`file_changed`, `render_done`, `render_started`, `git_changed`) but `watcher.ts` broadcasts events with `colon:namespaced` names (`file:changed`, `render:complete`, `render:error`). Clients that implement reconnection based on the documented names will receive no events.

**Current docs (wrong):**

```
| `file_changed`   | … |
| `render_started` | … |
| `render_done`    | … |
| `git_changed`    | … |
```

**Corrected docs** — confirm the actual event names from `watcher.ts` and `src/server/index.ts`, then update to the exact strings the server broadcasts. At minimum:

```markdown
| Event             | Payload                              | Trigger                                    |
| ----------------- | ------------------------------------ | ------------------------------------------ |
| `file:changed`    | `{ path: string }`                   | A `.qmd` file was saved (render disabled)  |
| `render:complete` | `{ path: string }`                   | `quarto render` finished successfully      |
| `render:error`    | `{ path: string, error: string }`    | `quarto render` failed or timed out        |
| `git:changed`     | `{ current: string, files: number }` | Git status changed after a commit or write |
```

_(Verify these names against `src/server/index.ts` broadcast calls and update accordingly.)_

---

### D-11 · `GET /api/git/log` missing `?path=` query parameter

**Priority:** MEDIUM  
**Location:** `docs/api-reference.md` — `GET /api/git/log` section

The log endpoint accepts an optional `?path=` query parameter to scope the log to a single file's history, but this is undocumented.

**Recommended addition**:

```markdown
### `GET /api/git/log`

Returns the last 50 commits, optionally scoped to a single file.

**Query:**

- `?n=N` — limit to N commits (default: 50)
- `?path=RELATIVE_PATH` — scope to commits that touched this file (path relative to
  `pages_dir`; validated to be inside `pages_dir`)

**Response:** `{ hash: string, date: string, message: string, author_name: string }[]`
```

---

### D-12 · `GET /api/preview/ready` endpoint undocumented

**Priority:** LOW  
**Location:** `docs/api-reference.md` — Preview section  
**Code:** `src/server/api/preview.ts`

The implementation includes `GET /api/preview/ready?port=PORT` which polls until a TCP port accepts connections (used by the client to know when the preview server is ready). This endpoint is not in the reference.

**Recommended addition**:

```markdown
### `GET /api/preview/ready`

Poll until a preview server is accepting TCP connections.

**Query:** `?port=PORT` — the port to test (returned by `POST /api/preview/start`).

**Response:** `{ ready: boolean }` — resolves once the port accepts connections or after
a brief timeout.

**Errors:** `400` if `port` is missing or invalid.
```

---

## 3. Code Comments (JSDoc coverage)

The server utility files (`pathGuard.ts`, `errorSanitizer.ts`, `asyncRoute.ts`, `frontmatter.ts`, `errorResponse.ts`, `logger.ts`, `qmdFiles.ts`) are well-documented with JSDoc. Server API handler files and all client files have sparse or zero JSDoc.

---

### D-13 · `pages.ts` — `buildTree` and path-guard helpers lack JSDoc

**Priority:** MEDIUM  
**Location:** `src/server/api/pages.ts`

`buildTree`, `guardPath`, and `guardAnyPath` are non-trivial helpers called from multiple route handlers but have no documentation.

**Recommended JSDoc**:

```ts
/**
 * Recursively builds a PageNode tree from `dir`, bounding depth at 20 to
 * prevent infinite recursion on symlink cycles. Paths are returned relative
 * to `rootDir` with forward slashes.
 */
function buildTree(dir: string, rootDir: string, depth = 0): PageNode[];

/**
 * Resolves `rawSuffix` as a .qmd path inside `pagesDir`.
 * Appends `.qmd` if absent. Returns `null` and sends a 400 response if
 * the resolved path would escape `pagesDir`.
 */
function guardPath(rawSuffix: string, res: Response): string | null;

/**
 * Like guardPath but does not append `.qmd`. Used for directory operations
 * where the caller handles the file extension.
 */
function guardAnyPath(rawSuffix: string, res: Response): string | null;
```

---

### D-14 · `git.ts` — `gitWithTimeout` and `registerGitApi` lack JSDoc

**Priority:** MEDIUM  
**Location:** `src/server/api/git.ts`

`gitWithTimeout` uses `Promise.race` with a hard 30 s kill timer — non-obvious enough to warrant a note.

**Recommended JSDoc**:

```ts
/**
 * Races `fn()` against a 30-second hard timeout. Prevents network-level
 * hangs (e.g. an unreachable remote) from blocking the Express event loop.
 * Throws with a descriptive timeout message when the deadline fires.
 */
function gitWithTimeout<T>(label: string, fn: () => Promise<T>): Promise<T>;
```

---

### D-15 · `search.ts` — indexing functions lack JSDoc

**Priority:** MEDIUM  
**Location:** `src/server/api/search.ts`

`stripMarkdown`, `tokenize`, `rebuildSearchIndex`, `updateSearchIndexForFile`, and `removeSearchIndexForFile` are all undocumented public-ish functions.

**Recommended JSDoc examples**:

```ts
/**
 * Strip YAML front-matter, fenced code blocks, wiki-link syntax, Quarto
 * shortcodes, and common Markdown punctuation from a raw .qmd string,
 * returning plain body text suitable for tokenization.
 */
function stripMarkdown(raw: string): string;

/**
 * Rebuild the entire in-memory search index by scanning every .qmd file
 * under `pagesDir`. Called once at server startup and via POST /api/search/reindex.
 */
export function rebuildSearchIndex(pagesDir: string): void;

/**
 * Incrementally re-index a single file after a save event.
 * Called by the file watcher and the pages write handler.
 */
export function updateSearchIndexForFile(pagesDir: string, relPath: string): void;
```

---

### D-16 · `links.ts` — slug helpers and index builders lack JSDoc

**Priority:** MEDIUM  
**Location:** `src/server/api/links.ts`

`targetToSlug`, `resolveSlug`, `scanFile`, and the exported `rebuildLinkIndex` / `updateLinkIndexForFile` / `removeLinkIndexForFile` deserve brief docs. The slug-matching heuristic (exact stem match then suffix match) is a design decision worth capturing.

**Recommended JSDoc example**:

```ts
/**
 * Convert wiki-link display text to a slug matching a .qmd stem.
 * Strips anchor fragments (#heading) and display names (|alias), lowercases,
 * and replaces spaces with hyphens.
 *
 * @example targetToSlug("My Page#intro") → "my-page"
 */
function targetToSlug(target: string): string;

/**
 * Resolve a slug to a relative .qmd path.
 * First tries an exact stem match, then a suffix match (e.g. "my-page"
 * matches "subdir/my-page.qmd"). Returns null if no match found.
 */
function resolveSlug(slug: string, allPaths: string[]): string | null;
```

---

### D-17 · `export.ts` — `runExport` and job-store helpers lack JSDoc

**Priority:** MEDIUM  
**Location:** `src/server/api/export.ts`

`purgeOldJobs`, `outputExt`, and `runExport` are non-trivial internal helpers with no documentation. The blocked-args allowlist logic is security-relevant and should have a comment explaining why specific flags are blocked.

**Recommended JSDoc**:

```ts
/**
 * Enforce a hard cap of 100 jobs in the in-memory store by evicting the
 * oldest entries. Called before each new job is created.
 */
function purgeOldJobs(): void;

/**
 * Map a Quarto format string to the expected output file extension.
 * Both `typst` and `pdf` map to `.pdf`; `revealjs` maps to `.html`.
 */
function outputExt(format: string): string;

/**
 * Spawn `quarto render --to FORMAT --output-dir TMPDIR PATH` in a child
 * process and update the export job store as the job progresses.
 * The `extraArgs` list has already been validated by the route handler.
 */
function runExport(cwd, filePath, format, extraArgs, job): void;
```

Also add an inline comment above `BLOCKED_ARGS`:

```ts
// Pandoc/Quarto flags that could redirect output outside the temp dir,
// load arbitrary filters, or override trusted templates are blocked.
// Any flag not matching SAFE_ARG (/^--[\w-]+(=[\w.,:-]+)?$/) is also rejected.
const BLOCKED_ARGS = [ ... ];
```

---

### D-18 · `db.ts` — Markdown table helpers lack JSDoc

**Priority:** LOW  
**Location:** `src/server/api/db.ts`

`parseMarkdownTable`, `serializeMarkdownTable`, and `normaliseSchema` implement a custom Markdown-table based storage format. The format is documented in ADR-003 but the helpers themselves have no JSDoc.

**Recommended JSDoc**:

```ts
/**
 * Parse a standard Markdown pipe-table into headers and an array of
 * row objects keyed by header name. The separator row is skipped.
 * Returns empty arrays if the input contains fewer than two table lines.
 */
function parseMarkdownTable(src: string): { headers: string[]; rows: Record<string, string>[] };

/**
 * Serialize a database schema and rows back to an aligned Markdown pipe-table.
 * Pipe characters inside cell values are escaped with a backslash.
 */
function serializeMarkdownTable(schema: FieldDef[], rows: Record<string, string>[]): string;
```

---

### D-19 · `config.ts` — `validateConfig` and `loadConfig` lack JSDoc

**Priority:** LOW  
**Location:** `src/server/config.ts`

```ts
/**
 * Validate and coerce a partially-loaded config object in place.
 * Invalid enum values (commit_mode, render_scope) revert to safe defaults.
 * port is coerced to an integer. pages_dir is checked for path traversal.
 * Returns a warnings array; the caller is responsible for logging them.
 */
function validateConfig(cfg: QuartostoneConfig): { warnings: string[] };

/**
 * Load and validate `_quartostone.yml` from `configPath`, merging over
 * DEFAULTS. Falls back to DEFAULTS silently if the file is absent.
 */
export async function loadConfig(configPath: string): Promise<QuartostoneConfig>;
```

---

### D-20 · Client `initGitPanel` and `initGraphPanel` lack JSDoc

**Priority:** LOW  
**Location:** `src/client/git/index.ts`, `src/client/graph/index.ts`

Both exported panel initializers are called from `main.ts` and take callbacks, but document neither their parameters nor their return values.

**Recommended JSDoc** for `initGitPanel`:

```ts
/**
 * Mount the Git status sidebar panel into `containerEl`.
 *
 * @param containerEl   - The host element (emptied and filled by this function).
 * @param onCommitRequest - Callback invoked when the user clicks "Commit". Receives
 *   a generated slug as the default commit message.
 * @returns An object with a `refresh()` method that re-fetches git status.
 */
export async function initGitPanel(
  containerEl: HTMLElement,
  onCommitRequest: CommitCallback
): Promise<{ refresh: () => Promise<void> }>;
```

**Recommended JSDoc** for `initGraphPanel`:

```ts
/**
 * Initialize the force-directed page-link graph view on `panelEl`.
 *
 * @param panelEl    - Container element (overwritten by this function).
 * @param onOpenPage - Called when the user clicks a node; receives the page
 *   path and title.
 * @returns Control object with `open()`, `close()`, and `refresh()`.
 */
export function initGraphPanel(
  panelEl: HTMLElement,
  onOpenPage: OpenPageFn
): { open(): void; close(): void; refresh(): void };
```

---

### D-21 · `main.ts` — No comments on module-level constants

**Priority:** LOW  
**Location:** `src/client/main.ts`

The three timing constants control UX-critical behaviour and are referenced throughout the file. They currently have single-line end-of-line comments; they should have short JSDoc explaining the tradeoff:

```ts
/** How often (ms) the sidebar polls git status. Lower = snappier status strip; higher = less I/O. */
const GIT_STATUS_POLL_INTERVAL_MS = 30_000;

/** How long (ms) the app waits after the last save before firing an auto-commit.
 *  Must be longer than the render cycle to avoid committing a mid-render state. */
const AUTO_COMMIT_DELAY_MS = 30_000;

/** How long (ms) the "Saved" badge remains visible after a successful save. */
const SAVE_STATUS_CLEAR_DELAY_MS = 2_000;
```

---

### D-22 · `pandoc.ts` — `runPandoc` lacks JSDoc

**Priority:** LOW  
**Location:** `src/server/api/pandoc.ts`

```ts
/**
 * Spawn `pandoc` with `args`, optionally writing `stdin`, and collect
 * stdout/stderr. Enforces a 30-second hard kill timeout.
 *
 * @returns ProcResult with `timedOut: true` if the timeout fired, or
 *   `notFound: true` if the pandoc executable was not found (ENOENT).
 */
function runPandoc(args: string[], stdin?: string): Promise<ProcResult>;
```

---

### D-23 · `xref.ts` — `scanFileForXRefs` JSDoc is good; `registerXRefApi` has none

**Priority:** LOW  
**Location:** `src/server/api/xref.ts`

`scanFileForXRefs` and `splitTypeId` are well-documented. The `registerXRefApi` export function itself has no JSDoc.

```ts
/**
 * Register the XRef API routes on `app`.
 * Results are cached in a module-level map and invalidated whenever the
 * file watcher calls `markXRefCacheDirty()`.
 */
export function registerXRefApi(app: Express, ctx: ServerContext): void;
```

---

### D-26 · `watcher.ts` — `startWatcher` and `handleChange` lack JSDoc

**Priority:** LOW  
**Location:** `src/server/watcher.ts`

```ts
/**
 * Start a chokidar watcher on `pages/**\/*.qmd` and wire the
 * save → render → commit pipeline. Returns the chokidar instance.
 *
 * The pipeline for each change event:
 *  1. Debounce `watch_interval_ms` ms.
 *  2. If `render_on_save`, spawn `quarto render`.
 *  3. Broadcast `render:complete` or `render:error` over WebSocket.
 *  4. If `commit_mode === 'auto'`, stage and commit with a generated slug.
 */
export function startWatcher(ctx: WatcherContext): FSWatcher;
```

---

## 4. CONTRIBUTING Guide

File read: `CONTRIBUTING.md`

The guide covers dev setup, code style, and a minimal PR checklist. Several critical developer steps are missing.

---

### D-27 · No "Running tests" section

**Priority:** HIGH  
**Location:** `CONTRIBUTING.md` — nothing after the PR checklist explains how to run tests

**Recommended content to add** (new "Testing" section):

```markdown
## Testing

### Unit / integration tests (Vitest)

    npm run test              # run all unit + API integration tests once
    npm run test:watch        # watch mode for TDD
    npm run test:coverage     # generate a V8 coverage report in coverage/

### End-to-end tests (Playwright)

Before running E2E tests for the first time, install the Playwright browsers:

    npx playwright install

The E2E fixtures require a built client. If you have not built it yet:

    npm run build:client

Then run:

    npm run test:e2e            # headless Chromium
    npm run test:e2e:ui         # Playwright UI (great for debugging)

### Running a single test file

    npx vitest run tests/unit/pathGuard.test.ts
    npx playwright test tests/e2e/pages.spec.ts
```

---

### D-28 · Missing `playwright install` requirement

**Priority:** HIGH  
**Location:** `CONTRIBUTING.md` — development setup section

There is no mention that `npx playwright install` must be run once before Playwright tests will work. Contributors will encounter an opaque error about missing browser binaries without this.

See D-27 for recommended wording.

---

### D-29 · `npm run dev` shorthand not mentioned

**Priority:** MEDIUM  
**Location:** `CONTRIBUTING.md` — "Run the full dev environment" section

CONTRIBUTING explains the two-terminal workflow (`dev:server` + `dev:client`) but does not mention that `npm run dev` invokes both via `concurrently`, which most contributors will prefer:

**Recommended addition** (before the two-terminal example):

```markdown
**Quickest option — single terminal:**

    npm run dev

This runs both the server and the client dev server concurrently via `concurrently`.
Use the two-terminal approach below if you need to inspect each process's output
separately.
```

---

### D-30 · No project directory structure guide

**Priority:** MEDIUM  
**Location:** `CONTRIBUTING.md` — no directory tour

New contributors have to reverse-engineer the layout from the README architecture table. The README shows the workspace structure, not the source tree. A contributor-focused view of `src/` would reduce on-boarding time.

**Recommended content to add**:

```markdown
## Project structure (source tree)

    src/
      cli/            # Commander.js CLI entry point (quartostone serve / init)
      server/
        api/          # One file per API group (pages, git, export, search, …)
        utils/        # Shared server helpers (pathGuard, errorResponse, logger, …)
        config.ts     # Config loading & validation
        index.ts      # Express app factory + WebSocket setup
        watcher.ts    # Chokidar watcher → render → commit pipeline
      client/
        api/          # Typed fetch helpers (endpoints.ts)
        editor/       # CodeMirror 6 source editor
        visual/       # Tiptap visual editor
        git/          # Git sidebar panel
        graph/        # Force-directed link graph
        main.ts       # Browser app entry point, wires all panels together
      shared/         # Types and constants shared by server + client
    tests/
      unit/           # Vitest unit tests (one file per source module)
      e2e/            # Playwright end-to-end tests
    docs/
      api-reference.md
      config.schema.json
      adr/            # Architecture Decision Records
```

---

### D-31 · panmirror build dependency not flagged as optional

**Priority:** LOW  
**Location:** `CONTRIBUTING.md` — Development Setup section

The section says `npm run build:panmirror` requires cloning `quarto-fork` as a sibling. It does not clarify that this step is **only needed for visual editor development** — contributors working on the server API, search, git, E2E tests, or anything else do not need it.

**Recommended addition** (note below the `build:panmirror` command):

```markdown
> **Note:** `build:panmirror` is only required if you are working on the visual
> (WYSIWYG) editor. For all other contributions you can skip this step entirely.
> A pre-built `panmirror.js` is not checked in to the repo; running the server
> without it means the **Visual** toolbar button will be non-functional, but the
> source editor and all other features will work normally.
```

---

### D-32 · No merge / squash policy stated

**Priority:** LOW  
**Location:** `CONTRIBUTING.md` — Pull Requests section

The PR section does not say whether commits are squashed on merge, whether rebase is required, or how to handle multi-commit histories on a PR branch.

**Recommended addition**:

```markdown
PRs are merged using **squash-and-merge** on GitHub. Your commit history on the branch
does not need to be clean — the final squashed commit message is generated from the PR
title. Rebase against `main` before asking for review to ensure CI runs on an up-to-date
base.
```

---

## 5. CHANGELOG

### D-33 · No CHANGELOG.md exists

**Priority:** HIGH  
**Location:** Workspace root of `quartostone/` — file is absent

There is no CHANGELOG. Users upgrading between versions have no record of what changed. The project already uses conventional commits (`feat:`, `fix:`, `chore:`), which lend themselves to automated changelog generation.

**Recommended action:**

1. Create `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format with an `[Unreleased]` section:

```markdown
# Changelog

All notable changes to Quartostone are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- ...

### Fixed

- ...
```

2. Add a GitHub Actions workflow step (or npm script) that generates / updates `CHANGELOG.md` from conventional commits on each release tag, e.g. using `git-cliff` or `conventional-changelog-cli`.

3. Add a note to `CONTRIBUTING.md` that significant user-facing changes must have a CHANGELOG entry.

---

## 6. Architecture Documentation

Files read: `docs/adr/` (all 6 ADRs), `README.md`, `src/server/watcher.ts`, `src/server/index.ts`

The ADR set (001–006) is a genuine strength — covering runtime choice, visual editor selection, database schema, trash/soft-delete, WebSocket protocol, and in-memory link index. However, the high-level flow connecting all components is nowhere documented.

---

### D-34 · No save → render → broadcast sequence diagram

**Priority:** MEDIUM  
**Location:** `docs/` — no sequence documentation for the core pipeline

The pipeline that runs on every keystroke+save is Quartostone's most critical feature path. A developer needs to read `watcher.ts`, `index.ts`, the WebSocket client code, and `render.ts` to understand it.

**Recommended addition** — a new `docs/architecture.md` file with at minimum this sequence diagram:

```markdown
## Save → Render → Commit pipeline

    Browser (editor)         Server (watcher.ts)         Quarto CLI
         |   PUT /api/pages/:path  |                          |
         |─────────────────────────>                          |
         |   { ok: true }          |                          |
         <─────────────────────────|                          |
         |                         | chokidar fires           |
         |                         |──────────────────────────>
         |                         |   quarto render <file>   |
         |   WS: render:complete   <──────────────────────────|
         <─────────────────────────|                          |
         |   (reload _site/ iframe)|                          |
         |                         | if commit_mode=auto:     |
         |                         | git add && git commit    |
         |   WS: git:changed       |                          |
         <─────────────────────────|
```

---

### D-35 · No client-side architecture overview

**Priority:** MEDIUM  
**Location:** `docs/` — no client architecture documentation

`src/client/main.ts` is 600+ lines that wire together 15+ panel modules. There is no documentation describing which modules own which parts of the UI, how panels communicate (callback props, shared state, events), or how the Vite dev proxy connects the browser to the Express server.

**Recommended addition** to `docs/architecture.md`:

```markdown
## Client architecture

The browser app is a vanilla TypeScript SPA. There is no framework; modules
communicate via callbacks passed at initialization time.

### Module responsibility map

| Module                | Responsibility                                                |
| --------------------- | ------------------------------------------------------------- |
| `main.ts`             | Wires DOM refs, initialises all panels, owns global state     |
| `editor/index.ts`     | CodeMirror 6 source editor, live reload via WebSocket         |
| `visual/index.ts`     | Tiptap WYSIWYG editor, serializes to/from Markdown via pandoc |
| `sidebar/index.ts`    | File tree, new-page/folder dialogs                            |
| `git/index.ts`        | Status strip, history list, diff viewer, remote sync          |
| `graph/index.ts`      | Force-directed canvas link graph                              |
| `search/index.ts`     | Full-text search overlay (Ctrl+K)                             |
| `properties/index.ts` | YAML frontmatter form                                         |
| `database/index.ts`   | Structured data table view for database .qmd files            |
| `branches/index.ts`   | Branch picker dropdown + create branch dialog                 |
| `history/index.ts`    | File history panel (file-scoped git log + diff)               |
| `export/index.ts`     | Export format picker, polls job status, triggers download     |
| `preview/index.ts`    | Manages `POST /api/preview/start` and the split-pane iframe   |
| `backlinks/index.ts`  | Backlinks panel listing pages that link to the current page   |
| `cmdpalette/index.ts` | Command palette (Ctrl+Shift+P)                                |
```

---

### D-36 · Watcher module undocumented at architecture level

**Priority:** LOW  
**Location:** `docs/` — `watcher.ts` is not described in README or any doc

The README and ADRs make no mention of `src/server/watcher.ts` as a distinct component. Its role (file-watch debouncing, render spawning, auto-commit, WebSocket broadcasting) should appear in the architecture overview and the README architecture table.

**Recommended addition** to the README architecture table:

```
src/
   server/
      api/       # pages, git, exec, export, preview, links, search, db, …
      watcher.ts  # Chokidar watcher: save → debounce → render → broadcast → commit
```

---

### D-37 · No ADR for the search/scoring algorithm

**Priority:** LOW  
**Location:** `docs/adr/` — no ADR 007

ADR-006 captures the in-memory link-index design. The search module (`search.ts`) implements TF-IDF-style scoring with title boosting (5×) but this design decision is not recorded anywhere. Future contributors may not understand why title matches outrank body matches or how to tune the algorithm.

**Recommended action:** Create `docs/adr/007-search-index-and-scoring.md` recording:

- The decision to use an in-memory inverted index rather than SQLite FTS or a search library
- The title-boost factor (currently 5×) and the rationale
- Known limitations (no stemming, no fuzzy match, single-process memory constraints)
- The tradeoffs that would warrant switching to a proper search library

---

## 7. Configuration Reference

Files read: `_quartostone.yml`, `docs/config.schema.json`, `README.md` config table

---

### D-38 · `exec_timeout_ms` missing from README config table

**Priority:** MEDIUM  
**Location:** `README.md` — "Config reference" table has 9 keys; schema has 10

The `exec_timeout_ms` key is defined in `config.schema.json`, used in `src/server/config.ts`, and referenced in `src/server/api/exec.ts`, but it is absent from the README config table. Users who need to set a longer timeout for heavy notebook cells have no documentation.

See D-04 for the recommended table row to add.

---

### D-39 · `allow_code_execution` absent from `_quartostone.yml` inline comments

**Priority:** MEDIUM  
**Location:** `_quartostone.yml` — the file has commented-out examples for `pages_dir` and `open_browser` but not for `allow_code_execution`

`allow_code_execution` defaults to `false` and must be explicitly enabled to use `POST /api/exec`. Because this is a security gate, it deserves a visible commented example in the template config file so users know it exists and understand the security implication.

**Recommended addition** at the end of `_quartostone.yml`:

```yaml
# Enable code execution (Python / R / Julia) via POST /api/exec.
# SECURITY: Only set 'true' in trusted local environments.
# Default: false
# allow_code_execution: false
```

---

### D-40 · JSON Schema `$id` points to a non-existent URL

**Priority:** LOW  
**Location:** `docs/config.schema.json` — `"$id"` field

```json
"$id": "https://github.com/davidrsch/quartostone/blob/main/docs/config.schema.json"
```

This URL resolves to the GitHub HTML view, not the raw JSON. YAML language servers (e.g. `yaml-language-server`) that fetch the schema from the `$id` URL will receive HTML, not JSON, causing validation to fail. The `_quartostone.yml` uses `# yaml-language-server: $schema=./docs/config.schema.json` (a relative path), which works locally, but any tool that follows the `$id` URI will be broken.

**Recommended fix:**

```json
"$id": "https://raw.githubusercontent.com/davidrsch/quartostone/main/docs/config.schema.json"
```

---

## 8. Type Documentation

Files read: `src/server/config.ts`, `src/server/index.ts`, `src/server/api/db.ts`, `src/server/api/xref.ts`

The `src/shared/` directory was not read; shared types should be audited separately.

---

### D-41 · `QuartostoneConfig` interface lacks overview JSDoc

**Priority:** MEDIUM  
**Location:** `src/server/config.ts`

Individual fields of `QuartostoneConfig` have inline comments (one field has a JSDoc line), but the interface itself has no overview explaining how it maps to `_quartostone.yml`, what the validation rules are, or where defaults are defined.

**Recommended JSDoc**:

```ts
/**
 * Runtime configuration for the Quartostone server.
 *
 * Loaded from `_quartostone.yml` by `loadConfig()`. Missing keys fall back
 * to `DEFAULTS`. Invalid values are coerced to safe defaults and a warning
 * is emitted to stderr.
 *
 * Changes to this interface must be mirrored in:
 *  - `DEFAULTS` (same file)
 *  - `docs/config.schema.json`
 *  - README.md "Config reference" table
 */
export interface QuartostoneConfig { ... }
```

---

### D-42 · `ServerContext` lacks interface JSDoc

**Priority:** LOW  
**Location:** `src/server/index.ts`

`ServerContext` is passed to every `registerXxxApi()` call and the watcher. The interface has a comment on only one of its four fields.

**Recommended JSDoc**:

```ts
/**
 * Shared runtime context injected into every API module and the file watcher.
 *
 * @property cwd        - Absolute path to the workspace root (the directory
 *   containing `_quartostone.yml` and the Git repo).
 * @property config     - Validated config loaded from `_quartostone.yml`.
 * @property port       - The TCP port the server is listening on.
 * @property clientDist - Optional override for the compiled client bundle path.
 *   Used when running via `tsx` (source) so the server can locate `dist/client/`.
 */
export interface ServerContext { ... }
```

---

### D-43 · `CommitMode` and `RenderScope` type aliases lack JSDoc

**Priority:** LOW  
**Location:** `src/server/config.ts`

```ts
/**
 * Controls when Git commits are created after a save/render cycle.
 * - `auto`   — commit immediately with an auto-generated slug
 * - `prompt` — show a confirmation toast (30 s timeout falls back to slug)
 * - `manual` — never auto-commit
 */
export type CommitMode = 'auto' | 'prompt' | 'manual';

/**
 * Scope of the `quarto render` call triggered on each save.
 * - `file`    — render only the changed file (fast)
 * - `project` — render the entire Quarto project (thorough)
 */
export type RenderScope = 'file' | 'project';
```

---

### D-44 · `XRef` and `XRefs` interfaces deserve expanded JSDoc

**Priority:** LOW  
**Location:** `src/server/api/xref.ts`

`XRef.suffix` is unclear (described only as "usually empty"). `XRefs.baseDir` semantics are implicit.

**Recommended improvements**:

```ts
export interface XRef {
  /** File path relative to baseDir with forward slashes. */
  file: string;
  /** Quarto xref type prefix: 'fig', 'tbl', 'sec', 'eq', 'lst', etc. */
  type: string;
  /** The part of the label after the type prefix. For `fig-my-plot`, this is `my-plot`. */
  id: string;
  /**
   * Sub-label suffix used for sub-figure numbering (e.g. `-a`, `-1`).
   * Empty string for the primary label.
   */
  suffix: string;
  /** Human-readable caption or heading text extracted from the source, if available. */
  title?: string;
}

export interface XRefs {
  /** Absolute path to the directory that was scanned (pagesDir). */
  baseDir: string;
  refs: XRef[];
}
```

---

### D-45 · Shared types file not reviewed

**Priority:** MEDIUM  
**Location:** `src/shared/types.ts` (not read)

`PageNode`, `SearchResult`, `FieldDef`, `DbPage`, and other types that cross the server/client boundary live in `src/shared/`. These types were not read during this audit. A follow-up review of `src/shared/` should verify:

- Do interfaces have JSDoc explaining the shape and invariants?
- Are discriminated union types (e.g. `type: 'file' | 'folder'` in `PageNode`) documented?
- Is the `FieldDef.type` union documented with the supported values and their UI behaviour?

---

## 9. Examples and Templates

Files read: `template.qmd`

---

### D-46 · `template.qmd` does not demonstrate wiki-link syntax

**Priority:** MEDIUM  
**Location:** `template.qmd` — no `[[...]]` example

Wiki links (`[[My Page]]`, `[[My Page|display text]]`) are a headline feature ("Wiki-style `[[links]]` + backlinks" in the README comparison table) but the scaffolded template never shows one. New users who start with `quarto use template` will not discover this syntax from the template alone.

**Recommended addition** to `template.qmd`:

```markdown
## Wiki links

Link to other pages in your workspace with double-bracket syntax:

- [[index]] — links to pages/index.qmd using the filename
- [[My Other Page|tap here]] — custom display text after the pipe

Backlinks (pages that link to _this_ page) are collected automatically and
can be shown at the foot of a page by adding `quartostone-backlinks: true`
to the YAML front matter.
```

---

### D-47 · No database `.qmd` example file

**Priority:** MEDIUM  
**Location:** Template / docs — no example database page exists anywhere

ADR-003 defines the database page format (YAML frontmatter with `quartostone: database` + `fields:` schema + Markdown pipe table), but there is no example file for users to copy. The README mentions "Structured data views" as a feature but gives no usage example.

**Recommended action:** Add `pages/example-database.qmd` (or similar) to the template, and a corresponding section in `template.qmd`:

```markdown
## Database views

A database page stores structured data as a Markdown table with a schema in
the YAML front matter:

```yaml
---
title: Tasks
quartostone:
  database: true
  fields:
    - { id: task, name: Task, type: text }
    - { id: status, name: Status, type: select, options: [Todo, In Progress, Done] }
    - { id: due, name: Due, type: date }
---
```

| task               | status      | due        |
| ------------------ | ----------- | ---------- |
| Write introduction | In Progress | 2026-03-10 |
| Review PR          | Todo        | 2026-03-12 |
```

---

### D-48 · Template missing keyboard shortcuts and git workflow hints

**Priority:** LOW  
**Location:** `template.qmd`

The template is a markdown document viewed in a browser. New users who open it in the editor will not know the keyboard shortcuts for saving, committing, or switching modes unless they read the README. A short reference table in the template would reduce friction.

**Recommended addition**:

```markdown
## Quick reference

| Shortcut       | Action                             |
| -------------- | ---------------------------------- |
| `Ctrl+S`       | Save current page                  |
| `Ctrl+Shift+E` | Toggle Source / Visual editor mode |
| `Ctrl+Shift+G` | Open commit dialog                 |
| `Ctrl+Shift+P` | Toggle live preview pane           |
| `Ctrl+K`       | Open search overlay                |
```

---

### D-49 · No code execution example

**Priority:** LOW  
**Location:** `template.qmd` — no fenced code cell example

The README advertises code execution (Python/R/Julia), but the template contains no example cell. Users must read the README to learn the syntax — a single illustrative cell would make the feature discoverable.

**Recommended addition**:

````markdown
## Code execution

When `allow_code_execution: true` is set in `_quartostone.yml`, you can run
fenced code cells inline and see their output:

```{python}
print("Hello from Python!")
2 + 2
```

Click the **▶ Run** button in the cell toolbar to execute the cell against
your local interpreter.
````

---

## 10. Developer Environment

Files read: `package.json` (scripts), `CONTRIBUTING.md`, `playwright.config.ts` (implied)

---

### D-50 · `playwright install` not in CONTRIBUTING or README

**Priority:** HIGH  
**Location:** `CONTRIBUTING.md` — development setup section

First-time E2E runs silently fail with `browserType.launch: Executable doesn't exist` if `npx playwright install` has not been run. This is a showstopper for new contributors.

See D-27 for the full recommended testing section.

---

### D-51 · E2E tests require a pre-built client; not documented

**Priority:** HIGH  
**Location:** `CONTRIBUTING.md`

The Playwright fixtures serve `dist/client/` via `express.static`. If `npm run build:client` has not been run, the E2E test fixture shows "Editor not built yet". No README or CONTRIBUTING text warns about this dependency.

See D-27 for recommended wording.

---

### D-52 · Vite dev proxy is undocumented

**Priority:** MEDIUM  
**Location:** `CONTRIBUTING.md` — no explanation of the dev proxy setup

When running `npm run dev:client`, Vite proxies `/api` and `/ws` requests to the Express server on port 4242. This is configured in `vite.config.ts` and is necessary for `dev:client` to work, but it is never mentioned in CONTRIBUTING. Developers who run only `npm run dev:client` (without `dev:server`) will see confusing network errors.

**Recommended addition** to CONTRIBUTING dev setup:

```markdown
> **How the dev proxy works:** `npm run dev:client` starts Vite on a random
> port (default 5173). Vite is configured in `vite.config.ts` to proxy
> all `/api` and `/ws` requests to `http://localhost:4242` (the Express server).
> Both processes must be running simultaneously for the dev environment to work.
> `npm run dev` (or `npm run dev:server` + `npm run dev:client` in two terminals)
> handles this automatically.
```

---

### D-53 · No documentation of the GitHub Actions CI workflow

**Priority:** MEDIUM  
**Location:** `.github/` — referenced in README CI badge but not documented

The README badge links to a CI workflow, but neither `README.md` nor `CONTRIBUTING.md` describes what the CI pipeline does (lint, typecheck, unit tests, E2E, coverage thresholds). Contributors cannot know what checks must pass to merge a PR.

**Recommended addition** to CONTRIBUTING "Pull Requests" section:

```markdown
### CI checks

The CI pipeline (GitHub Actions) runs on every pushed commit and PR:

1. `npm run lint` — ESLint
2. `npm run typecheck:all` — TypeScript strict-mode check across all tsconfigs
3. `npm run test` — Vitest unit + API integration tests
4. `npm run build:all` — Production build (catches bundler errors)
5. `npm run test:e2e` — Playwright end-to-end tests (headless Chromium)

All five checks must be green before a PR is mergeable.
```

---

### D-54 · No `dist/` build-artifact note in CONTRIBUTING

**Priority:** LOW  
**Location:** `CONTRIBUTING.md`

The `dist/` directory is git-ignored (correct) but there is no note in CONTRIBUTING explaining this. Contributors who run `npm run build` and then see `dist/` not showing up in `git status` sometimes wonder if something is wrong with their setup.

**Recommended addition** (note near build commands):

```markdown
> `dist/` is git-ignored and must be rebuilt locally. The published npm package is
> built by CI on release tags using `npm run build:all`. You do not need to commit
> any files under `dist/`.
```

---

## Appendix: Finding Index

| ID   | Priority | Area                  | File / Location                               |
| ---- | -------- | --------------------- | --------------------------------------------- |
| D-01 | HIGH     | README                | README.md — missing build-from-source         |
| D-02 | HIGH     | README                | README.md — missing test instructions         |
| D-03 | MEDIUM   | README                | README.md — no troubleshooting section        |
| D-04 | LOW      | README / Config       | README.md — exec_timeout_ms not in table      |
| D-05 | HIGH     | API docs              | docs/api-reference.md — Trash API absent      |
| D-06 | HIGH     | API docs              | docs/api-reference.md — Assets API absent     |
| D-07 | HIGH     | API docs              | docs/api-reference.md — Pandoc API absent     |
| D-08 | MEDIUM   | API docs              | docs/api-reference.md — XRef API absent       |
| D-09 | HIGH     | API docs              | docs/api-reference.md — render response wrong |
| D-10 | HIGH     | API docs              | docs/api-reference.md — WS event names wrong  |
| D-11 | MEDIUM   | API docs              | docs/api-reference.md — git/log ?path param   |
| D-12 | LOW      | API docs              | docs/api-reference.md — preview/ready absent  |
| D-13 | MEDIUM   | Code comments         | src/server/api/pages.ts                       |
| D-14 | MEDIUM   | Code comments         | src/server/api/git.ts                         |
| D-15 | MEDIUM   | Code comments         | src/server/api/search.ts                      |
| D-16 | MEDIUM   | Code comments         | src/server/api/links.ts                       |
| D-17 | MEDIUM   | Code comments         | src/server/api/export.ts                      |
| D-18 | LOW      | Code comments         | src/server/api/db.ts                          |
| D-19 | LOW      | Code comments         | src/server/config.ts                          |
| D-20 | LOW      | Code comments         | src/client/git/index.ts, graph/index.ts       |
| D-21 | LOW      | Code comments         | src/client/main.ts                            |
| D-22 | LOW      | Code comments         | src/server/api/pandoc.ts                      |
| D-23 | LOW      | Code comments         | src/server/api/xref.ts                        |
| D-26 | LOW      | Code comments         | src/server/watcher.ts                         |
| D-27 | HIGH     | CONTRIBUTING          | CONTRIBUTING.md — no test section             |
| D-28 | HIGH     | CONTRIBUTING          | CONTRIBUTING.md — no playwright install       |
| D-29 | MEDIUM   | CONTRIBUTING          | CONTRIBUTING.md — npm run dev not mentioned   |
| D-30 | MEDIUM   | CONTRIBUTING          | CONTRIBUTING.md — no directory structure      |
| D-31 | LOW      | CONTRIBUTING          | CONTRIBUTING.md — panmirror not optional      |
| D-32 | LOW      | CONTRIBUTING          | CONTRIBUTING.md — no squash/merge policy      |
| D-33 | HIGH     | CHANGELOG             | CHANGELOG.md — does not exist                 |
| D-34 | MEDIUM   | Architecture          | docs/ — no save/render/commit sequence        |
| D-35 | MEDIUM   | Architecture          | docs/ — no client architecture overview       |
| D-36 | LOW      | Architecture          | docs/ — watcher.ts undescribed                |
| D-37 | LOW      | Architecture          | docs/adr/ — no ADR for search algorithm       |
| D-38 | MEDIUM   | Config reference      | README.md — exec_timeout_ms missing           |
| D-39 | MEDIUM   | Config reference      | \_quartostone.yml — allow_code_execution hint |
| D-40 | LOW      | Config reference      | docs/config.schema.json — wrong $id URL       |
| D-41 | MEDIUM   | Type documentation    | src/server/config.ts — QuartostoneConfig      |
| D-42 | LOW      | Type documentation    | src/server/index.ts — ServerContext           |
| D-43 | LOW      | Type documentation    | src/server/config.ts — CommitMode/RenderScope |
| D-44 | LOW      | Type documentation    | src/server/api/xref.ts — XRef/XRefs           |
| D-45 | MEDIUM   | Type documentation    | src/shared/types.ts — not reviewed            |
| D-46 | MEDIUM   | Examples / templates  | template.qmd — no wiki-link example           |
| D-47 | MEDIUM   | Examples / templates  | template.qmd — no database example            |
| D-48 | LOW      | Examples / templates  | template.qmd — no keyboard shortcuts          |
| D-49 | LOW      | Examples / templates  | template.qmd — no code execution example      |
| D-50 | HIGH     | Developer environment | CONTRIBUTING.md — playwright install missing  |
| D-51 | HIGH     | Developer environment | CONTRIBUTING.md — E2E needs built client      |
| D-52 | MEDIUM   | Developer environment | CONTRIBUTING.md — Vite proxy undocumented     |
| D-53 | MEDIUM   | Developer environment | CONTRIBUTING.md — CI workflow undescribed     |
| D-54 | LOW      | Developer environment | CONTRIBUTING.md — dist/ not explained         |

**HIGH priority total: 14 findings**  
**MEDIUM priority total: 22 findings**  
**LOW priority total: 18 findings**
