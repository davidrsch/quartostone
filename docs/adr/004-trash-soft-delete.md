# ADR 004: Soft-delete via `.quartostone/trash` directory

**Status:** Accepted  
**Date:** 2026-03-05

## Context

QuartoStone users need to delete pages without risking accidental permanent data loss.
A hard delete (`fs.rmSync`) is not recoverable from within the app and, once committed,
requires a `git revert` to undo. Users familiar with Notion-style trash expect a way to
review and restore recently deleted items.

## Decision Drivers

| Factor                                           | Weight |
| ------------------------------------------------ | ------ |
| Recovery from accidental deletion                | High   |
| Git-friendliness (deletions visible in history)  | High   |
| Simplicity (no database, no extra dependencies)  | High   |
| Interoperability with the existing file watcher  | Medium |

## Decision

When a page is deleted via `DELETE /api/pages/:path`, the server:

1. Generates a random lowercase hex `id` for the trash item.
2. Moves the `.qmd` file to `.quartostone/trash/<id>.qmd`.
3. Writes a `.quartostone/trash/<id>.meta.json` sidecar with:
   ```json
   { "id": "...", "originalPath": "...", "name": "...", "deletedAt": "ISO8601" }
   ```
4. The link and search indexes are updated to remove the deleted page.

Restoration (`POST /api/trash/restore/:id`) reverses step 2 and removes the sidecar.
Permanent deletion (`DELETE /api/trash/:id`) removes both files from `.quartostone/trash/`.

The `.quartostone/` directory is **not** gitignored by default, so Git tracks the move
and the deletion is visible in `git log`.

## Consequences

**Positive:**

- Users can recover accidentally deleted pages without leaving the app.
- Git history shows the deletion as a file move / removal — fully auditable.
- No external database or state store required; plain files are inspectable.
- The trash directory survives server restarts.

**Negative:**

- Deleted files remain on disk until permanently purged; long-lived workspaces may
  accumulate stale trash entries.
- Restoration fails with `409` if the original path has been re-created in the meantime —
  the user must rename or permanently delete the existing file first.

## Alternatives Considered

### Immediate hard delete
Simple but irrecoverable within the app. Dismissed because accidental deletion is a
common user mistake in note-taking apps.

### Git-only soft delete (move to untracked branch)
More complex, requires Git operations for every delete/restore, and breaks the mental
model of the working tree as the source of truth.
