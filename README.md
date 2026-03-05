<p align="center">
  <img src="src/client/public/logo.png" alt="Quartostone" width="120" />
</p>

# Quartostone

> A Notion-like, Git-native knowledge base built on Quarto.

[![CI](https://github.com/davidrsch/quartostone/actions/workflows/ci.yml/badge.svg)](https://github.com/davidrsch/quartostone/actions/workflows/ci.yml)

**The core insight:** Notion is powerful but your data is locked in the cloud, can't run code, and has no real version history. Obsidian is local-first but can't execute code. Quartostone fills the gap.

| Feature                               | Notion | Obsidian | Quartostone |
| ------------------------------------- | ------ | -------- | ----------- |
| Execute code (R/Python/Julia)         |        |          |             |
| Git-native version control            |        | Plugin   |             |
| Self-hosted / local-first             |        |          |             |
| Visual (WYSIWYG) editor               |        |          |             |
| Plain-text source                     |        |          | `.qmd`      |
| Multi-format export (HTML/PDF/Slides) |        | Limited  |             |
| Live split-pane preview               |        |          |             |
| Branch picker + checkout              |        |          |             |
| Wiki-style `[[links]]` + backlinks    |        |          |             |
| Full-text search                      |        |          |             |
| Structured data views                 |        |          |             |
| No account / no cloud required        |        |          |             |

---

## Architecture

Quartostone is a **local web app** a thin Node.js/Express server you run on your machine, accessed through your browser. No Electron, no cloud, no database.

```
quartostone/
 _quartostone.yml      # App config (port, commit mode, render scope )
 _quarto.yml           # Quarto project config
 pages/                # Your .qmd note files (configurable via pages_dir)
    index.qmd
 _site/                # Quarto render output (auto-generated, gitignored)
 src/
    server/           # Express API + file watcher
       api/          # pages, git, exec, export, preview, links, search, db
    client/           # Browser app (CodeMirror + Tiptap, bundled by Vite)
 tests/
    unit/             # Vitest + Supertest API tests
    e2e/              # Playwright end-to-end tests
 docs/
     api-reference.md  # REST API & WebSocket reference
     adr/              # Architecture Decision Records
```

**Runtime stack:**

| Layer         | Technology                                                                       |
| ------------- | -------------------------------------------------------------------------------- |
| Server        | Node.js 22 LTS, Express, `simple-git`, `chokidar`, `ws`                          |
| Source editor | CodeMirror 6                                                                     |
| Visual editor | Tiptap (ProseMirror-based) see [ADR 002](docs/adr/002-visual-editor-approach.md) |
| Bundler       | Vite                                                                             |
| Tests         | Vitest (unit + Supertest) Playwright (E2E + visual regression)                   |
| Quarto        | User's installed `quarto` CLI rendering, export, preview                         |

---

## Getting Started

> **Prerequisites:** [Node.js 22+](https://nodejs.org) and [Quarto](https://quarto.org/docs/get-started/)

### Option A Quarto template (recommended)

```bash
quarto use template davidrsch/quartostone
cd my-notes
git init && git add . && git commit -m "init"

npm install -g quartostone
quartostone serve          #  http://localhost:4242
```

### Option B npm (manual setup)

```bash
npm install -g quartostone
quartostone init my-notes
cd my-notes
git init && git add . && git commit -m "init"
quartostone serve
```

---

## Building from source

```bash
git clone https://github.com/davidrsch/quartostone
cd quartostone
npm install
```

**Compile TypeScript (server + CLI):**

```bash
npm run build
```

**Build the Vite client bundle:**

```bash
npm run build:client
```

**Run in development mode** (hot-reload server + Vite HMR, both processes in one terminal):

```bash
npm run dev
```

Or start each process separately:

```bash
npm run dev:server   # Terminal 1 — Express server with tsx watch
npm run dev:client   # Terminal 2 — Vite dev server with HMR
```

> **Panmirror / Visual editor note:** The visual (WYSIWYG) editor depends on a local
> build of [panmirror](https://github.com/davidrsch/quarto). Clone that repo as a sibling
> of this repo (`../quarto-fork`) and run `npm run build:panmirror` once before starting
> the client. See [CONTRIBUTING.md](CONTRIBUTING.md) for full setup instructions.

---

## Running tests

**Unit tests** (Vitest + Supertest):

```bash
npm test
```

**End-to-end tests** (Playwright):

```bash
# First time only — install Playwright browser binaries
npx playwright install

# E2E tests require a production client build
npm run build:client
npm run test:e2e
```

---

## Troubleshooting

### "No \_quartostone.yml found"

Run `quartostone init` first, or `cd` into your workspace directory.

### Port already in use

Change the port in `_quartostone.yml`:

```yaml
port: 4243
```

Or pass `--port 4243` on the command line.

### Editor not built

Run `npm run build:client` from the project root.

### Quarto not found

Install [Quarto](https://quarto.org/docs/get-started/) and ensure it is on your `PATH`.
Run `quarto --version` to verify.

### Auth token prompt

On startup, quartostone prints an auth token. The browser editor reads it automatically via `GET /api/session`. CLI tools must include `Authorization: Bearer <token>` in every API request.

---

## Editor what you can do

### Pages

| Action              | How                                                     |
| ------------------- | ------------------------------------------------------- |
| **Create page**     | Click **+ New page** in the sidebar enter a name Create |
| **Create database** | Click ** Database** enter a name Create                 |
| **Open page**       | Click any file in the sidebar                           |
| **Delete page**     | Right-click Delete (or `DELETE /api/pages/:path`)       |
| **Rename**          | Edit the YAML `title:` field in the properties panel    |

### Editing modes

| Mode                        | How to activate                                                                  |
| --------------------------- | -------------------------------------------------------------------------------- |
| **Source** (CodeMirror)     | Default, or click the **Source** toolbar button                                  |
| **Visual** (Tiptap WYSIWYG) | Click the **Visual** toolbar button, or **Ctrl+Shift+E**                         |
| **Properties**              | Click the **Properties** toolbar button edit YAML front matter fields via a form |

### Keyboard shortcuts

| Shortcut             | Action                           |
| -------------------- | -------------------------------- |
| `Ctrl+S` / `S`       | Save current page                |
| `Ctrl+Shift+E` / `E` | Toggle source visual editor mode |
| `Ctrl+Shift+G` / `G` | Open commit dialog               |
| `Ctrl+Shift+P` / `P` | Toggle preview panel             |

### Git workflow

| Action            | Where                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Commit**        | Click **Commit** in the toolbar, or `Ctrl+Shift+G` enter a message and confirm. If ignored for 30 s the server auto-commits with a generated slug. |
| **Branch picker** | Click the branch name in the status bar switch branches (uncommitted changes are stashed and re-applied automatically)                             |
| **Create branch** | Click **+ New branch** in the Git panel                                                                                                            |
| **View history**  | Click the **History** panel lists commits with diffs                                                                                               |

### Export & Preview

| Action           | Where                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| **Live preview** | Click **Preview** or `Ctrl+Shift+P` starts `quarto preview` and opens a split pane                     |
| **Export**       | Click **Export** choose format (HTML/PDF/DOCX/RevealJS/EPUB/Typst) runs async, downloads on completion |

### Code execution

Any `.qmd` page with a fenced code cell (`python`, `r`, `julia`). Click ** Run** in the cell toolbar to execute against the local interpreter and see stdout/stderr inline.

---

## Config reference (`_quartostone.yml`)

Full JSON Schema: [`docs/config.schema.json`](docs/config.schema.json).

| Key                    | Default          | Description                                                                                                |
| ---------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `port`                 | `4242`           | TCP port for the dev server                                                                                |
| `pages_dir`            | `pages`          | Directory (relative to workspace root) where `.qmd` files live                                             |
| `render_on_save`       | `true`           | Run `quarto render` automatically on every save                                                            |
| `render_scope`         | `file`           | `file` = render only the changed file; `project` = render everything                                       |
| `watch_interval_ms`    | `300`            | Debounce window in milliseconds for the file watcher                                                       |
| `commit_mode`          | `prompt`         | `auto` = commit immediately; `prompt` = show confirm toast; `manual` = never auto-commit                   |
| `commit_message_auto`  | `qs-{alphanum8}` | Template for auto-generated commit messages                                                                |
| `open_browser`         | `true`           | Open the browser automatically on `quartostone serve`                                                      |
| `allow_code_execution` | `false`          | Enables `POST /api/exec`; defaults to `false` for security — only set `true` in trusted local environments |
| `exec_timeout_ms`      | `30000`          | Timeout in milliseconds for code execution (exec API).                                                     |

---

## Quarto extension

The `quartostone` Quarto extension (`_extensions/quartostone/`) provides three features that work in plain `quarto render` even without the Quartostone server:

| Feature             | Description                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- |
| **Custom callouts** | `::: {.callout-todo}` and `::: {.callout-question}` render as styled callout blocks           |
| **Backlinks**       | Pages with `quartostone-backlinks: true` in YAML get a linked backlinks section at the bottom |
| **Page footer**     | Each rendered page gets a footer showing the last Git commit message and date                 |

Disable the footer on a specific page:

```yaml
---
title: My Page
quartostone-footer: false
---
```

---

## API

Full REST API and WebSocket event reference: [`docs/api-reference.md`](docs/api-reference.md).

| Group       | Endpoints                                                                |
| ----------- | ------------------------------------------------------------------------ |
| Pages       | `GET/PUT/POST/DELETE /api/pages`                                         |
| Directories | `POST /api/directories`, `DELETE /api/directories/*`                     |
| Git         | `/api/git/status`, `/log`, `/diff`, `/commit`, `/branches`, `/checkout`  |
| Exec        | `POST /api/exec` run Python / R / Julia cells                            |
| Export      | `POST /api/export`, `GET /api/export/status`, `GET /api/export/download` |
| Preview     | `POST /api/preview/start`, `/stop`, `GET /api/preview/status`            |
| Search      | `GET /api/search`                                                        |
| Links       | `GET /api/links/graph`, `/forward`, `/backlinks`, `/search`              |
| Database    | `GET/PUT/DELETE /api/db`, `POST /api/db/create`                          |

---

## Development

```bash
git clone https://github.com/davidrsch/quartostone
cd quartostone
npm install

npm run dev:server       # Start server with hot-reload (tsx watch)
npm run build:client     # Build the browser client
npm test                 # Unit + integration tests (Vitest + Supertest)
npm run test:e2e         # E2E tests (requires built client)
npm run test:coverage    # Generate coverage report
```

---

## Architecture Decision Records

| ADR                                                | Decision                                              |
| -------------------------------------------------- | ----------------------------------------------------- |
| [001](docs/adr/001-runtime-node-vs-deno.md)        | Node.js 22 LTS over Deno 2                            |
| [002](docs/adr/002-visual-editor-approach.md)      | Tiptap over extracting panmirror from quarto-vscode   |
| [003](docs/adr/003-structured-data-file-schema.md) | YAML front matter + Markdown table for database pages |
| [004](docs/adr/004-trash-soft-delete.md)           | Soft-delete via `.quartostone/trash` directory        |
| [005](docs/adr/005-websocket-event-protocol.md)    | Raw WebSocket (`ws` library) for real-time events     |
| [006](docs/adr/006-in-memory-link-index.md)        | In-memory wiki-link index with file-change rebuild    |

---

## Project Board

Issues and planned work: [GitHub Project board](https://github.com/users/davidrsch/projects/15).

**Implementation status:**

| Phase | Description                                                                     | Status |
| ----- | ------------------------------------------------------------------------------- | ------ |
| 1     | CLI, local server, file watcher, CodeMirror editor, sidebar                     | Done   |
| 2     | Visual/WYSIWYG mode, Git history panel, page properties, commit UI              | Done   |
| 3     | Database views, single-cell execution, Quarto template distribution             | Done   |
| 4     | Vitest unit + Supertest integration tests, Playwright E2E, CI coverage gate     | Done   |
| 5     | Branch picker (create / switch), per-page commit timeline with diff             | Done   |
| 6     | Async export (HTML/PDF/DOCX/RevealJS/EPUB/Typst), live split-pane preview       | Done   |
| 7     | Wiki `[[links]]` + backlinks panel, full-text search, force-directed graph view | Done   |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
