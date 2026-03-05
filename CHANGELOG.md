# Changelog

All notable changes to quartostone are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added

- **TabBarManager class** (`src/client/tabbar/index.ts`) — replaces duplicate tab-bar logic
  in `main.ts` with a reusable `TabBarManager` (primary + secondary pane tabs)
- **Structured logger** (`src/server/utils/logger.ts`) — `log`, `warn`, `error` write to stderr
  with a `[quartostone]` prefix
- **Typed error-response helpers** (`src/server/utils/errorResponse.ts`) — `badRequest`,
  `notFound`, `conflict`, `serverError`, `forbidden` for consistent JSON error shapes
- **Git push/pull timeout** — 30-second hard timeout on `git push` and `git pull` via a
  `gitWithTimeout` utility, preventing indefinite hangs on slow/unresponsive remotes
- **Named constants** for all magic-number timeouts and intervals:
  `GIT_STATUS_POLL_INTERVAL_MS`, `AUTO_COMMIT_DELAY_MS`, `SAVE_STATUS_CLEAR_DELAY_MS`,
  `AUTOSAVE_DEBOUNCE_MS`, `SEARCH_DEBOUNCE_MS`, `RENDER_TIMEOUT_MS`
- **Unit tests**: `pathGuard.test.ts`, `errorSanitizer.test.ts`, `qmdFiles.test.ts`,
  `escape.test.ts`, `logger.test.ts`, `errorResponse.test.ts`, `tabbar.test.ts`

### Changed

- `express.json()` now enforces a **1 MB request size limit** to prevent memory-exhaustion DoS
- **Trash IDs** are now proper UUIDs (`randomUUID()`) instead of `Date.now()+random` strings;
  restore/delete endpoints validate the UUID format before touching the filesystem
- **DB schema `normaliseSchema`** validates field types against the `FieldType` union at runtime;
  unknown types silently fall back to `'text'` instead of being cast unchecked
- Export **download cleanup** defers temp-dir deletion when a stream is in progress
  (tracks `downloadStarted` timestamp to avoid the cleanup-vs-stream race condition)
- All server API files now use `errorResponse` helpers instead of inline `res.status().json()`
- `server/config.ts` and `server/watcher.ts` use the structured logger instead of `console.*`
- AbortController attached to the global `keydown` listener in `main.ts` (cleaned up on unload)

### Fixed

- `#btn-move-cancel` id added to the Cancel button in `openMoveDialog()` — fixes two failing
  E2E tests in `file-management.spec.ts`
- Missing `forbidden` import in `api/exec.ts` and `notFound` import in `api/export.ts`

---

## [0.1.0] — Initial release

### Added

- Quarto-native knowledge base with Git-backed version control
- CodeMirror 6 source editor with live-reload WebSocket
- Visual (WYSIWYG) editor backed by Panmirror
- Sidebar: file tree, drag-drop, rename, move, soft-delete (trash), favorites, recent pages
- Database pages: Markdown table-based structured data with filters and sorts
- Full-text search overlay
- Git panel: status, commit, push, pull, branch management, merge, history with diffs
- Export to PDF, DOCX, EPUB, HTML, RevealJS via `quarto render`
- Properties panel: YAML frontmatter editor
- Backlinks panel and interactive graph view
- Cross-reference picker (`@ref` autocomplete)
- Pandoc AST endpoint for visual editor
- Dark / light / system theme toggle
- Split-pane editor view
- Command palette (`Ctrl+K`)
- Code execution widget (Python / R / Julia via `quarto run`)
