# Changelog

All notable changes to Quartostone are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Quartostone uses [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Security

- **CRITICAL** — `/api/session` token endpoint now guarded by loopback check; requests from non-localhost addresses receive `403 Forbidden`.
- **HIGH** — `git:` protocol removed from allowed remote URL schemes (only `https:` and `ssh:` permitted), preventing SSRF via `git://` remote.
- **HIGH** — `String(e)` error serialisation in `pages.ts` and `trash.ts` replaced with `sanitizeError()` to avoid leaking file-system paths.
- **HIGH** — Rate limiting (10 req/min) added to `/api/git/push` and `/api/git/pull` network operations.
- **MEDIUM** — WebSocket connections now require a `?token=` query parameter matching the server token; mismatched connections are closed with code `1008`.
- **MEDIUM** — `quarto preview` subprocess now bound explicitly to `127.0.0.1` (`--host 127.0.0.1`), preventing LAN exposure.
- **MEDIUM** — Unbounded `stdout`/`stderr` accumulation in `render.ts` (5 MB cap) and `export.ts` (2 MB cap) to prevent heap OOM.
- **MEDIUM** — `Content-Disposition` filename now uses RFC 5987 dual-parameter encoding (`filename=` + `filename*=UTF-8''...`) to prevent header injection via special characters.

### Added

- Playwright browser cache step in CI E2E job (avoids re-downloading ~200 MB of browser binaries on every run).
- `concurrency` group in CI workflow to cancel stale queued runs on the same branch.
- `timeout-minutes` on all four CI jobs (15 min for lint/unit/build, 25 min for E2E).
- `npm audit --audit-level=high` step in `lint-typecheck` CI job.
- Prettier `format:check` step in `lint-typecheck` CI job.
- `lint:fix` npm script (`eslint --fix src tests`).
- `format:check` npm script (`prettier --check src tests`).
- `clean` npm script (removes the `dist/` directory).
- `@typescript-eslint/switch-exhaustiveness-check: error` ESLint rule.
- `@typescript-eslint/return-await: ['error', 'in-try-catch']` ESLint rule.
- `noFallthroughCasesInSwitch`, `noImplicitOverride`, `forceConsistentCasingInFileNames` TypeScript compiler flags.
- Auth/session section in `docs/api-reference.md` (documents `/api/session`, WebSocket `?token=` requirement, and loopback restriction).
- Environment variable table (`QUARTOSTONE_PORT`, `E2E_PORT`) in `CONTRIBUTING.md`.
- CI pipeline overview table in `CONTRIBUTING.md`.
- `git.fetch()` in `/api/git/remote` route now wrapped in `gitWithTimeout` to prevent indefinite hangs.

### Changed

- CI `typecheck` step changed to `typecheck:all` — client TypeScript config is now verified in CI.
- `client-dist` artifact retention increased from 1 day to 7 days.
- Identity map `status.conflicted.map(f => f)` replaced with spread `[...status.conflicted]`.
- Dead `?? ''` fallback removed from `search.ts` (ternary already guarantees a string).

### Fixed

- README keyboard shortcuts table corrected — removed bare single-key shortcuts (`S`, `E`, `G`, `P`) that had no corresponding key bindings; added `Ctrl+P`, `Ctrl+K`, `Ctrl+\`, `Ctrl+Shift+B`.

---

## [0.1.0] — Initial Release

- Local Node.js/Express server with Vite/TypeScript browser client.
- CodeMirror 6 source editor + Tiptap (ProseMirror) visual WYSIWYG editor.
- Git-native version control: status, commit, diff, log, branch, push/pull, merge conflict resolution.
- Full-text search with in-memory index.
- Multi-format export via Quarto CLI (HTML, PDF, DOCX, RevealJS, EPUB, Typst).
- Live `quarto preview` split-pane integration.
- Code-cell execution for Python/R/Julia via `POST /api/exec`.
- Trash / restore for soft-deleted pages.
- Structured data (database) views backed by YAML front matter.
- Playwright E2E test suite + Vitest unit/integration tests (700 tests).

[Unreleased]: https://github.com/davidrsch/quartostone/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/davidrsch/quartostone/releases/tag/v0.1.0
