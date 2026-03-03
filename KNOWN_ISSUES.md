# Known Issues

This document lists confirmed defects and missing features in the current release.
See [docs/technical-review.md](docs/technical-review.md) for the full analysis and development plan.

---

## Disabled Features

### Visual Editor (Source/Visual toggle)
**Status**: Disabled — button is grayed out  
**Reason**: The ProseMirror-based visual editor loses content on the first switch. YAML frontmatter, Quarto code-cell attributes (`{python}`, `#| echo: false`), math (`$...$`, `$$...$$`), and callout attributes are silently dropped when switching from source to visual mode and back. Using it would corrupt documents.  
**Plan**: Replace with Monaco Editor for source parity, then integrate the Quarto visual editor protocol for true WYSIWYG. See `docs/technical-review.md §3 Phase A`.

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

### Multiple Files Open
Only one file can be open at a time. Switching files with unsaved changes shows a confirm dialog; declining means staying on the current file.  
**Plan**: Tab bar is in Phase D.

---

## UI/UX Gaps

| Issue | Workaround |
|-------|-----------|
| Sidebar width is fixed (260px) | None |
| No light theme | None |
| Toolbar buttons have no visible keyboard shortcut labels | See `Ctrl+Shift+?` in README |
| No command palette | None |
| Branch picker and export dropdowns require a click outside to close | Fixed in v0.x.x (now close on `.hidden` class) |

---

## Resolved Issues (recently fixed)

| Issue | Fix |
|-------|-----|
| Export/branch dropdowns not closing | Added `.hidden { display: none }` CSS rules |
| Client assets served from wrong path when running from source | Pass explicit `clientDist` path in `serve.ts` |
| `GET /api/git/diff` rejected requests without `sha` | Made `sha` optional (returns working-tree diff) |
| `GET /api/preview/status` and `POST /api/preview/stop` rejected missing `path` | Made `path` optional |
