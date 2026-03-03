# Known Issues

This document lists confirmed defects and missing features in the current release.
See [docs/technical-review.md](docs/technical-review.md) for the full analysis and development plan.

---

## Beta Features

### Visual Editor (Source/Visual toggle)
**Status**: Available — powered by [panmirror](https://github.com/quarto-dev/quarto/tree/main/apps/panmirror), the same WYSIWYG engine used in RStudio and Positron  
**Requirements**: Pandoc must be on your system PATH (the editor uses `pandoc` to convert between markdown and its internal AST).  
**Known limitations**:
- Citation dialogs, image dialogs, and table-insert dialogs show browser-native prompts (full dialog UI coming in a future release)
- Cross-reference completion requires a running Quarto project  
**Plan**: See `docs/technical-review.md §3 Phase F` for full Quarto editor server integration.

---

## Broken Features

### Preview Pane
**Status**: Stable — resolved in Phase 9  
Automatic PATH detection, readiness polling, and hot-reload after save are all implemented.
The workaround (manual `quarto preview`) is no longer needed.

---

## Missing Features

### File Management
**Status**: Implemented — resolved in Phase 11  
The sidebar now supports:
- Create page (toolbar button or context menu → "New page here")
- Create folder (toolbar button or context menu → "New folder here")
- Rename file or folder (double-click, F2, or context menu → ✎ Rename)
- Delete file to trash (context menu → 🗑 Delete; can be restored from the Trash tray)
- Permanently delete folder (context menu → 🗑 Delete folder)
- Move file or folder via drag-and-drop to any folder in the tree
- Move file or folder via context menu → 📁 Move to… (keyboard-accessible)
- Duplicate page (context menu → ⧉ Duplicate, creates a `-copy` variant)
- Right-click context menu on all tree items

No workaround needed.

### Split Editor Pane
Only a single editor and preview pane are shown at one time. Side-by-side editing of two files is not yet implemented.  
**Plan**: `docs/technical-review.md §3 Phase D P3`

---

## UI/UX Gaps

| Issue | Workaround |
|-------|-----------|
| No split editor pane | Open two browser tabs |
| No breadcrumb navigation in editor header | Check status bar for current file path |
| Branch picker opens a native browser prompt | Type branch name directly |

---

## Resolved Issues (recently fixed)

| Issue | Fix |
|-------|-----|
| Preview pane showed "Quarto not found" when Quarto was on a non-default PATH | Automatic PATH detection + readiness polling added (Phase 9) |
| Preview iframe went blank until manual reload | Hot-reload after save wired to iframe (Phase 9) |
| Sidebar was fully read-only (no rename/move/delete/context menu) | Full file management UI with context menus, inline rename, DnD, Move-to dialog, Duplicate, Trash tray (Phase 11) |
|-------|-----|
| Visual editor (Tiptap) silently corrupted content on round-trip | Replaced with panmirror (Phase 10) |
| Sidebar width was fixed at 260 px | Resizable via drag handle (Phase 8) |
| No light/dark theme toggle | Theme toggle added in toolbar (Phase 8) |
| Toolbar buttons had no tooltips | `title` attribute added to all buttons (Phase 8) |
| No command palette | Ctrl+K command palette added (Phase 8) |
| Only one file open at a time | Tab bar with multi-file support added (Phase 8) |
| File tree had no keyboard navigation | Arrow keys, F2, Delete implemented (Phase 8) |
| Export/branch dropdowns not closing | Added `.hidden { display: none }` CSS rules |
| Client assets served from wrong path when running from source | Pass explicit `clientDist` path in `serve.ts` |
| `GET /api/git/diff` rejected requests without `sha` | Made `sha` optional (returns working-tree diff) |
| `GET /api/preview/status` and `POST /api/preview/stop` rejected missing `path` | Made `path` optional |
