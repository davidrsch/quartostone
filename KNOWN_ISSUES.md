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
**Status**: Available but unreliable  
**Symptoms**:
- "Quarto not found" error when Quarto is installed but not on the system PATH used by the Node.js process
- Preview iframe shows blank or partially rendered page immediately after start (Quarto hasn't finished rendering yet)
- Hot-reload after save is not wired to the preview iframe; you must manually reload

**Workaround**: Run `quarto preview <file>` manually in a terminal and open the resulting URL in a browser.  
**Plan**: `docs/technical-review.md §3 Phase B`

---

## Missing Features

### File Management
The sidebar is **read-only**. Missing:
- Create folder
- Rename file or folder
- Delete file or folder
- Move file (drag-and-drop or cut/paste)
- Right-click context menu

**Workaround**: Use the terminal or your OS file manager. The sidebar will refresh on next page load.  
**Plan**: `docs/technical-review.md §3 Phase C`

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
