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

| Event type       | Payload                               | Trigger                                    |
| ---------------- | ------------------------------------- | ------------------------------------------ |
| `file_changed`   | `{ path: string }`                    | A `.qmd` file was saved                    |
| `render_started` | `{ path: string }`                    | `quarto render` started                    |
| `render_done`    | `{ path: string, ok: boolean }`       | `quarto render` completed                  |
| `git_changed`    | `{ current: string, files: number }`  | Git status changed after a commit or write |
