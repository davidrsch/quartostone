# Contributing to Quartostone

Thank you for your interest in contributing!

## Issues

Use the issue templates:

- **Bug** — something is broken
- **PBI** — a new user-facing feature
- **Spike** — a research/investigation task
- **Task** — infrastructure or technical work

All issues are tracked on the [project board](https://github.com/users/davidrsch/projects/15).

## Development Setup

**Prerequisites:** Node.js 22+, Quarto, Git

The visual editor relies on a local build of [panmirror](../quarto-fork). Clone it as a sibling of this repo:

```bash
git clone https://github.com/davidrsch/quarto quarto-fork
# clones to ../quarto-fork relative to this repo, which is the path the build script expects
```

```bash
git clone https://github.com/davidrsch/quartostone
cd quartostone
npm install
npm run build:panmirror   # builds src/client/public/panmirror.js from ../quarto-fork
```

**Run the full dev environment (two terminals):**

Terminal 1 — server with hot reload:

```bash
npm run dev:server
```

Terminal 2 — Vite client with HMR:

```bash
npm run dev:client
```

Then open `http://localhost:4242` in your browser.

**Typecheck + lint:**

```bash
npm run typecheck          # server + shared code
npm run typecheck:client   # client-side TypeScript
npm run typecheck:all      # validate all TypeScript configs at once
npm run lint
```

## Running Tests

**Unit tests** (Vitest + Supertest):

```bash
npm test
```

**End-to-end tests** (Playwright):

```bash
# First time only — install Playwright browser binaries
npx playwright install

# E2E tests render the client, so build it first
npm run build:client
npm run test:e2e
```

## Code Style

- TypeScript strict mode — no `any` without justification
- Prettier for formatting (`npm run format`)
- ESLint for lint (`npm run lint`)
- Commit messages: use conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)

## Environment Variables

| Variable           | Default | Description                                                                   |
| ------------------ | ------- | ----------------------------------------------------------------------------- |
| `QUARTOSTONE_PORT` | `4242`  | Override the server port (takes precedence over `_quartostone.yml`)           |
| `E2E_PORT`         | `4243`  | Port used by Playwright E2E tests to avoid clashing with a running dev server |

## CI Pipeline

Pull requests and pushes to `main` run four GitHub Actions jobs:

| Job                    | What it checks                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| **Lint & Typecheck**   | `typecheck:all` (server + client + test configs), ESLint, Prettier format check, `npm audit`  |
| **Unit & Integration** | Vitest tests + Supertest API tests with coverage; uploads `coverage/` artifact                |
| **Build**              | `npm run build` (server/CLI) + `npm run build:client` (Vite); uploads `client-dist/` artifact |
| **E2E**                | Playwright Chromium tests (depends on Unit and Build jobs); uploads `playwright-report/`      |

All jobs have a `timeout-minutes` cap; a concurrency group cancels stale runs on the same branch.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes with tests where applicable
3. Ensure `npm run typecheck:all` and `npm run lint` pass
4. Open a PR and link the related issue
