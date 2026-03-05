# Quartostone API Reference

All endpoints are served by the local Quartostone dev server (default: `http://localhost:4242`). Every request and response body is JSON unless noted otherwise.

---

## Health

### `GET /api/health`

Returns `{ ok: true }` when the server is running. Used by the Playwright webServer readiness probe.

---

## Pages

### `GET /api/pages`

Returns the full file tree of `.qmd` pages under `pages_dir`.

**Response:** Array of `{ type: 'file'|'dir', path: string, name: string, children?: [...] }`.

---

### `GET /api/pages/:path`

Read a single page file.

**Response:** `{ path: string, content: string }`

**Errors:** `404` if not found; `400` if the path traverses outside `pages_dir`.

---

### `PUT /api/pages/:path`

Create or overwrite a page.

**Body:** `{ content: string }`

**Response:** `{ ok: true, path: string }`

---

### `POST /api/pages`

Create a new blank page with a `.qmd` stub.

**Body:** `{ path: string }` — relative to `pages_dir`, `.qmd` extension appended if absent.

**Response:** `{ ok: true, path: string }`

**Errors:** `400` if `path` is missing or invalid; `409` if the file already exists.

---

### `DELETE /api/pages/:path`

Delete a page.

**Response:** `{ ok: true }`

---

## Directories

### `POST /api/directories`

Create a new directory (including nested parents).

**Body:** `{ path: string }` — relative to `pages_dir`.

**Response:** `{ ok: true, path: string }` — `201 Created`

**Errors:** `400` if `path` is missing, invalid, or traverses outside `pages_dir`; `409` if the directory already exists.

---

### `DELETE /api/directories/*`

Delete an empty directory.

**Response:** `{ ok: true }` — `200 OK`

**Errors:** `400` if the path traverses outside `pages_dir` or the target is a file (not a directory); `404` if the directory does not exist; `409` if the directory is not empty.

---

## Git

### `GET /api/git/status`

**Response:** `{ current: string, files: { path: string, index: string, working_dir: string }[] }`

---

### `GET /api/git/log`

Returns the last 50 commits.

**Query:** `?n=N` to limit to N commits.

**Response:** `{ hash: string, date: string, message: string, author_name: string }[]`

---

### `POST /api/git/commit`

Stage all changes and create a commit.

**Body:** `{ message: string }`

**Response:** `{ ok: true, hash: string }`

---

### `GET /api/git/diff`

**Query:** `?sha=COMMIT_SHA` (optional)

- Without `sha`: returns the unstaged working-tree diff.
- With `sha`: returns the diff introduced by that specific commit.

**Response:** `{ diff: string }`

---

### `GET /api/git/branches`

**Response:** `{ current: string, branches: { name: string, current: boolean, sha: string, date: string }[] }`

---

### `POST /api/git/branches`

Create a new branch at HEAD and check it out.

**Body:** `{ name: string }` — must match `/^[\w\-./]+$/`.

**Response:** `{ ok: true, name: string }`

**Errors:** `400` for invalid/missing name.

---

### `POST /api/git/checkout`

Switch to an existing branch, auto-stashing and re-applying uncommitted changes.

**Body:** `{ branch: string }`

**Response:** `{ ok: true, branch: string, stashed: boolean, stashConflict?: boolean }`

---

### `GET /api/git/remote`

Return the origin remote URL plus ahead/behind counts (performs a `git fetch --no-tags --prune` to refresh tracking info).

**Response:** `{ url: string, branch: string, tracking: string, ahead: number, behind: number }`

**Errors:** `500` on git failure.

---

### `PATCH /api/git/remote`

Set (or add) the `origin` remote URL.

**Body:** `{ url: string }` — must use `https`, `http`, `ssh`, or `git` protocol; `file://` is rejected.

**Response:** `{ ok: true }`

**Errors:** `400` if `url` is missing, invalid, or uses a disallowed protocol.

---

### `POST /api/git/push`

Push the current branch to `origin`.

**Response:** `{ ok: true, pushed: object }`

**Errors:** `500` on push failure (e.g. authentication error, non-fast-forward).

---

### `POST /api/git/pull`

Pull from `origin` using fast-forward only (`--ff-only`).

**Response:** `{ ok: true, summary: { changes: number, insertions: number, deletions: number } }`

**Errors:** `409` if the remote has diverged and a fast-forward is not possible; `500` on other git errors.

---

### `POST /api/git/merge`

Merge a branch into the current branch (no-fast-forward — always creates a merge commit).

**Body:** `{ branch: string, message?: string }` — `branch` must match `/^[\w\-./]+$/`.

**Response:** `{ ok: true, commit: string }`

**Errors:** `400` for invalid/missing branch; `409` if there are merge conflicts (includes `{ conflicts: string[] }`); `500` on other errors.

---

### `POST /api/git/merge-abort`

Abort an in-progress merge, restoring the pre-merge state.

**Response:** `{ ok: true }`

**Errors:** `500` if there is no merge in progress.

---

### `GET /api/git/conflicts`

List conflicted files in the working tree (useful after a failed merge).

**Response:** `{ conflicted: string[] }` — paths relative to the workspace root.

---

### `POST /api/git/merge-complete`

Stage all pages and create the merge commit after manually resolving conflicts.

**Response:** `{ ok: true, commit: string }`

**Errors:** `500` if git commit fails (e.g. unresolved conflicts remain).

---

### `GET /api/git/show`

Fetch the raw content of a file at a specific commit.

**Query:** `?sha=COMMIT_SHA&path=RELATIVE_PATH` — `sha` must be a 4–64 character hex string; `path` must be within `pages_dir`.

**Response:** `{ content: string, sha: string, path: string }`

**Errors:** `400` for invalid sha or path; `404` if the file did not exist at that commit.

---

### `POST /api/git/restore`

Restore a file in the working tree to its content at a specific commit (HEAD is unchanged).

**Body:** `{ sha: string, path: string }` — `sha` must be 4–64 hex chars; `path` must be within `pages_dir`.

**Response:** `{ ok: true, sha: string, path: string }`

**Errors:** `400` for invalid sha or unsafe path; `500` on git failure.

---

## Render

### `POST /api/render`

Run `quarto render` on a single file or the whole project.

**Body:** `{ path: string, scope?: 'file'|'project' }`

**Response:** `{ ok: boolean, stdout: string, stderr: string }`

---

## Preview

### `POST /api/preview/start`

Start `quarto preview` for a file.

**Body:** `{ path: string, format?: string }`

**Response:** `{ ok: true, url: string }` — URL of the live preview server.

**Errors:** `400` if `path` is missing; `409` if a preview is already running.

---

### `POST /api/preview/stop`

Stop a running preview.

**Body:** `{ path?: string }` — if omitted, stops **all** running previews.

**Response:** `{ ok: true, wasRunning?: boolean, stopped?: number }`

---

### `GET /api/preview/status`

**Query:** `?path=PATH` (optional)

- Without `path`: `{ running: boolean, count: number }` — whether any preview is active.
- With `path`: `{ running: boolean, url?: string, path?: string }` — state for a specific file.

---

## Export

Exports are asynchronous. POST to start a job, poll the status endpoint, then download when `status === 'done'`.

### `POST /api/export`

**Body:** `{ path: string, format: 'html'|'pdf'|'docx'|'revealjs'|'epub'|'typst', extraArgs?: string[] }`

**Response:** `{ token: string, status: 'pending' }` — `202 Accepted`

---

### `GET /api/export/status?token=TOKEN`

**Response:** `{ token: string, status: 'pending'|'running'|'done'|'error', filename?: string, error?: string }`

---

### `GET /api/export/download?token=TOKEN`

Download the exported file when `status === 'done'`. Returns the file as an attachment.

**Errors:** `409` if the job is not yet complete; `404` if the token is unknown.

---

## Exec (code cell execution)

### `POST /api/exec`

Run a code snippet in an isolated subprocess.

**Body:** `{ language: 'python'|'python3'|'r'|'julia', code: string }`

**Response:** `{ ok: boolean, stdout: string, stderr: string, exitCode: number|null, timedOut: boolean }`

- Python falls back from `python` → `python3` automatically on ENOENT.
- Timeout is 30 seconds; `timedOut: true` if exceeded.

**Errors:** `403` if `allow_code_execution` is `false` in `_quartostone.yml`; `500`/`501` if the interpreter is not installed.

---

## Database views

### `GET /api/db/:path`

Parse a `.qmd` database page (YAML schema + Markdown table).

**Response:** `{ fields: Field[], rows: Record<string, string>[] }` — see [ADR 003](adr/003-structured-data-file-schema.md) for the schema.

---

### `PUT /api/db/:path/row`

Upsert a row by primary key.

**Body:** `{ row: Record<string, string> }`

**Response:** `{ ok: true }`

---

### `DELETE /api/db/:path/row/:primary`

Delete a row by primary field value.

**Response:** `{ ok: true }`

---

### `POST /api/db/create`

Scaffold a new blank database page.

**Query:** `?path=pages/tasks.qmd`

**Body:** `{ title: string }`

**Response:** `{ ok: true, path: string }`

---

## Links & graph

### `GET /api/links/graph`

**Response:** `{ nodes: { id: string, label: string }[], edges: { source: string, target: string }[] }`

---

### `GET /api/links/forward?path=PATH`

Pages that the given page links to.

**Response:** `string[]`

---

### `GET /api/links/backlinks?path=PATH`

Pages that link to the given page.

**Response:** `string[]`

---

### `GET /api/links/search?q=QUERY`

Autocomplete for `[[wiki-links]]` — returns pages whose path or title contains `q`.

**Response:** `{ path: string, title: string }[]`

---

## Search

### `GET /api/search?q=QUERY`

Full-text search across all pages.

**Response:** `{ path: string, title: string, score: number, excerpt: string }[]`

---

### `POST /api/search/reindex`

Force a full reindex of all pages (normally happens automatically on file changes).

**Response:** `{ ok: true, count: number }`

---

## WebSocket events

Connect to `ws://localhost:PORT` to receive real-time file-change events.

| Event type       | Payload                              | Trigger                                    |
| ---------------- | ------------------------------------ | ------------------------------------------ |
| `file_changed`   | `{ path: string }`                   | A `.qmd` file was saved                    |
| `render_started` | `{ path: string }`                   | `quarto render` started                    |
| `render_done`    | `{ path: string, ok: boolean }`      | `quarto render` completed                  |
| `git_changed`    | `{ current: string, files: number }` | Git status changed after a commit or write |

---

## Trash

Soft-deleted pages are moved to `.quartostone/trash/` with a `.meta.json` sidecar file. See [ADR 004](adr/004-trash-soft-delete.md).

### `GET /api/trash`

List all soft-deleted pages, sorted newest-first.

**Response:** `{ id: string, originalPath: string, name: string, deletedAt: string }[]`

---

### `POST /api/trash/restore/:id`

Restore a trashed page to its original path.

**Params:** `:id` — alphanumeric trash item identifier.

**Response:** `{ ok: true, path: string }` — `path` is the restored location relative to `pages_dir`.

**Errors:** `400` for invalid `id` or corrupt metadata; `404` if the item is not found; `409` if the original path already exists again.

---

### `DELETE /api/trash/:id`

Permanently destroy a trashed page (both the `.qmd` file and its `.meta.json` sidecar).

**Params:** `:id` — alphanumeric trash item identifier.

**Response:** `{ ok: true }`

**Errors:** `400` for invalid `id`; `404` if not found; `500` on filesystem error.

---

## Pandoc bridge

Thin proxy routes used by the panmirror visual editor to communicate with the local `pandoc` binary. All routes time out after 30 seconds.

### `POST /api/pandoc/capabilities`

Return pandoc version, API version, available output formats, and highlight languages. The result is cached in memory after the first call.

**Response:** `{ version: string, api_version: number[], output_formats: string, highlight_languages: string }`

**Errors:** `503` if pandoc is not installed.

---

### `POST /api/pandoc/markdownToAst`

Convert Markdown source to a pandoc JSON AST.

**Body:** `{ markdown: string, format: string, options?: string[] }` — `options` is a validated allowlist of safe `--flag` or `--flag=value` arguments; dangerous flags (`--output`, `--filter`, etc.) are silently dropped.

**Response:** Pandoc JSON AST document object.

**Errors:** `400` for missing/invalid body; `503` if pandoc not found; `504` on timeout.

---

### `POST /api/pandoc/astToMarkdown`

Convert a pandoc JSON AST back to the specified Markdown format.

**Body:** `{ ast: object, format: string, options?: string[] }`

**Response:** Markdown string (quoted JSON string).

**Errors:** `400` for missing/invalid body; `503` if pandoc not found; `504` on timeout.

---

### `POST /api/pandoc/listExtensions`

List the pandoc extensions available for a given format.

**Body:** `{ format: string }` — must match `/^[\w+-]+$/`.

**Response:** Newline-separated extension list (plain string).

**Errors:** `400` for invalid format; `503` if pandoc not found.

---

### `POST /api/pandoc/getBibliography`

Stub endpoint — bibliography support is not yet implemented. Returns an empty bibliography structure for panmirror compatibility.

**Response:** `{ etag: string, bibliography: { sources: [], project_biblios: [] } }`

---

### `POST /api/pandoc/addToBibliography`

No-op stub. Returns `true` for panmirror compatibility.

**Response:** `true`

---

### `POST /api/pandoc/citationHTML`

No-op stub. Returns an empty string for panmirror compatibility.

**Response:** `""` (empty string)

---

## Cross-references

Scans all `.qmd` and `.md` files under `pages_dir` for Quarto cross-reference labels (`fig-*`, `tbl-*`, `sec-*`, `eq-*`, `lst-*`, theorem-like envs) and returns them in a shape compatible with the panmirror editor. Results are cached in memory and invalidated by the file watcher.

### `POST /api/xref/index`

Return all cross-reference labels in the project.

**Body:** `{ file?: string }` — `file` is reserved for future scoped scanning; the full project is always scanned.

**Response:**

```json
{
  "baseDir": "/abs/path/to/pages",
  "refs": [{ "file": "intro.qmd", "type": "fig", "id": "myplot", "suffix": "", "title": "My Plot" }]
}
```

---

### `POST /api/xref/forId`

Return the cross-reference entry for a specific label (e.g. `fig-myplot`).

**Body:** `{ file?: string, id: string }` — `id` must be in `type-rest` format (e.g. `"fig-myplot"`).

**Response:** Same shape as `/api/xref/index` but `refs` contains only the matching entry (empty array if not found).

**Errors:** `400` if `id` is missing.

---

## Assets

Handles image uploads used by the panmirror visual editor. Files are stored in `pages/_assets/` and served as static files.

### `POST /api/assets`

Upload an image file. Accepts `multipart/form-data` with a single field named `file`.

**Constraints:**

- Allowed extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.avif`, `.bmp`, `.ico`
- Allowed MIME types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`, `image/avif`, `image/tiff`, `image/bmp`, `image/x-icon`
- Maximum file size: 20 MB

**Response:** `{ url: string, filename: string }` — `201 Created`. `url` is the path to serve the file (e.g. `/assets/1700000000000_photo.png`).

**Errors:** `400` if no file is uploaded or the file type is not allowed.

---

### `GET /assets/:filename`

Serve a previously uploaded image. This is a static file endpoint, not under `/api/`.

**Response:** The image binary with the appropriate `Content-Type`.

**Errors:** `400` for an empty/invalid filename; `404` if the file does not exist.
