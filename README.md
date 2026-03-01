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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
