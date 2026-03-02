# Quartostone

> A Notion-like, Git-native knowledge base built on Quarto.

[![CI](https://github.com/davidrsch/quartostone/actions/workflows/ci.yml/badge.svg)](https://github.com/davidrsch/quartostone/actions/workflows/ci.yml)

**The core insight:** Notion is powerful but your data is locked in the cloud, can't run code, and has no real version history. Obsidian is local-first but can't execute code. Quartostone fills the gap.

| Feature                               | Notion | Obsidian | Quartostone   |
| ------------------------------------- | ------ | -------- | ------------- |
| Execute code (R/Python/Julia)         | ❌     | ❌       | ✅            |
| Git-native version control            | ❌     | Plugin   | ✅            |
| Self-hosted / local-first             | ❌     | ✅       | ✅            |
| Visual (WYSIWYG) editor               | ✅     | ✅       | ✅ (Phase 2)  |
| Plain-text source                     | ❌     | ✅       | ✅ `.qmd`     |
| Multi-format output (HTML/PDF/Slides) | ❌     | Limited  | ✅ via Quarto |
| Auto-commit on save                   | ❌     | ❌       | ✅            |
| No account / no cloud required        | ❌     | ✅       | ✅            |
| Structured data views (table/kanban)  | ✅     | ❌       | ✅ (Phase 3)  |

## Architecture

Quartostone is a **local web app** — a thin Node.js server you run on your machine, accessed through your browser. No Electron, no cloud, no database.

```
quartostone/
├── _quarto.yml          # Quarto project config
├── _quartostone.yml     # Quartostone app config
├── pages/               # Your .qmd note files
│   └── index.qmd
├── _site/               # Quarto render output (auto-generated)
└── .github/             # CI + issue templates
```

**Runtime stack:**

- **Quarto** — rendering engine (user's existing install)
- **Node.js** — thin local server, file watch, Git ops
- **CodeMirror 6** — source mode editor (~500KB, MIT)
- **panmirror / ProseMirror** — visual WYSIWYG editor (Phase 2, adapted from Quarto VS Code)
- **simple-git** — Git operations, no native compilation

## Getting Started

> **Prerequisites:** [Node.js 22+](https://nodejs.org) and [Quarto](https://quarto.org/docs/get-started/)

### Option A — Quarto template (recommended)

Scaffold a new workspace with a single command using the Quarto template:

```bash
quarto use template davidrsch/quartostone
```

Quarto will prompt for a directory name, copy all workspace files, and install
the `quartostone` Quarto extension. Then:

```bash
cd my-notes
git init && git add . && git commit -m "init"

# Install the Quartostone server
npm install -g quartostone

# Start the editor
quartostone serve
# → Opens http://localhost:4242
```

### Option B — npm (manual)

```bash
# Install
npm install -g quartostone

# Create a new workspace
quartostone init my-notes
cd my-notes
git init && git add . && git commit -m "init"

# Start the editor
quartostone serve
# → Opens http://localhost:4242
```

### Quarto extension features

The `quartostone` Quarto extension (`_extensions/quartostone/`) provides three
features that work even without the Quartostone server:

| Feature             | Description                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Custom callouts** | `::: {.callout-todo}` and `::: {.callout-question}` render as styled callout blocks         |
| **Backlinks**       | Pages listing `quartostone-backlinks:` in YAML get a linked backlinks section at the bottom |
| **Page footer**     | Each rendered page gets a footer showing the last Git commit message and date               |

Disable the footer on a specific page by adding `quartostone-footer: false` to
its YAML front matter.

## Development

```bash
git clone https://github.com/davidrsch/quartostone
cd quartostone
npm install
npm run dev:server
```

## Project Board

Issues and planned work are tracked on the [GitHub Project board](https://github.com/users/davidrsch/projects/15).

**Phases:**

- **Phase 1 – Core MVP:** CLI, local server, file watcher, CodeMirror editor, sidebar
- **Phase 2 – Polish:** Visual/WYSIWYG mode, Git history panel, page properties, commit UI
- **Phase 3 – Power Features:** Database views, remote push/pull, Quarto template distribution, single-cell execution
- **Phase 4 – Testing Infrastructure:** Vitest unit + integration tests (Supertest), Playwright E2E + visual-regression baseline, CI coverage gate ≥ 80 %
- **Phase 5 – Git-Native Versioning:** Branch picker in the toolbar (create / switch / merge), per-page commit timeline with side-by-side diff, one-click file restore at any commit
- **Phase 6 – Quarto Export & Preview:** Async export to HTML, PDF, DOCX, RevealJS, EPUB, Typst; live split-pane preview via `quarto preview` with hot-reload on save
- **Phase 7 – Knowledge Graph & Discovery:** Wiki-style `[[page]]` links + backlinks panel, full-text search (⌘K palette), force-directed graph view of the page link network

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
