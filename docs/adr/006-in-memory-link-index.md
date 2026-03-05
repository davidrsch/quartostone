# ADR 006: In-memory wiki-link index with file-change rebuild

**Status:** Accepted  
**Date:** 2026-03-05

## Context

QuartoStone supports `[[wiki-links]]` between pages and a force-directed graph view.
Serving backlinks, forward-links, and link-graph queries requires knowing, for every
page, which other pages it links to. The options considered were: a **SQLite database**,
an **on-disk JSON index file**, and a **pure in-memory map** rebuilt from source files.

## Decision Drivers

| Factor                                                  | Weight |
| ------------------------------------------------------- | ------ |
| Query latency (backlinks, graph, autocomplete)          | High   |
| Zero external runtime dependencies                      | High   |
| Correctness after file changes                          | High   |
| Workspace size (QuartoStone targets ≤ ~10 000 pages)    | Medium |
| Persistence across server restarts                      | Low    |

## Decision

Maintain two in-memory maps on the Express server:

- `forwardLinks: Map<relPath, Set<relPath>>` — outgoing `[[wiki-links]]` per file.
- `pageMeta: Map<relPath, { path, title, tags, excerpt }>` — lightweight page metadata.

**Startup:** `rebuildLinkIndex(pagesDir)` scans all `.qmd` files once via a simple
regex (`WIKI_LINK_SCAN_RE`) and populates both maps. Typical cold-start time for
1 000 pages is under 100 ms on an SSD.

**Incremental updates:** The `chokidar` file watcher calls `updateLinkIndexForFile`
on `add` / `change` / `unlink` events, re-scanning only the affected file.

**Backlinks** are computed on-demand by inverting `forwardLinks` at query time —
no reverse map is persisted. Query time is O(pages) but negligible at expected
workspace sizes.

**Autocomplete** (`GET /api/links/search?q=`) filters `pageMeta` in-process; no
full-text engine is needed.

## Consequences

**Positive:**

- Backlink, forward-link, and graph queries return in < 1 ms once the index is warm.
- No SQLite binary, no migration scripts, no schema versioning.
- The index is always consistent with the filesystem — a server restart rebuilds it.
- Incremental updates keep the index accurate during live editing sessions.

**Negative:**

- The index is lost on server restart and must be rebuilt (acceptable — cold-start
  rebuild is fast).
- Memory usage scales linearly with the number of pages and total link count. For
  extremely large workspaces (> 50 000 pages) a persistent index would be preferable.
- Concurrent file-change events that race between `add` and `unlink` could briefly
  produce stale data (mitigated by the watcher debounce interval).

## Alternatives Considered

### SQLite (better-sqlite3)
Persistent, supports complex queries. But adds a native addon build step, complicates
distribution (`npm pack`), and is unnecessary at the target workspace scale.

### On-disk JSON index file
Avoids the native dependency but introduces read/write races, invalidation logic, and
a stale-file problem when the server is not running during external file edits.
Rebuilding from source on startup is simpler and equally fast.
