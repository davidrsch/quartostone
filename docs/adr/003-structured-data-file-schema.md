# ADR 003: Structured Data File Schema — Database Pages

**Date**: 2025-07  
**Status**: Accepted  
**Closes**: Spike #16

---

## Context

Issue #16 asked us to study how AppFlowy models its grid/database feature and extract a design for Quartostone's structured data views, backed by plain files (CSV + YAML header, or `.qmd`).

PBI #28 requires structured data views — a table/kanban database page type — as a Phase 3 feature.

---

## AppFlowy Data Model Study

### Architecture overview

AppFlowy uses a **Dart frontend** (Flutter) and a **Rust backend** (`flowy-database2`) with a CRDT-based document model. There is no plain-text storage — rows, columns, and cells are stored as binary-encoded CRDT operations in an SQLite database.

### Relevant findings

| Concept          | AppFlowy                                              | Quartostone equivalent             |
| ---------------- | ----------------------------------------------------- | ---------------------------------- |
| Database         | `DatabasePB` (Rust struct, stored in SQLite)          | `.qmd` file with YAML front matter |
| Fields (columns) | `FieldPB { id, name, field_type, ... }`               | YAML sequence of field descriptors |
| Rows             | `RowPB { id, cells: HashMap<field_id, CellPB> }`      | CSV rows below the YAML block      |
| Views            | `DatabaseViewPB { layout: Grid/Kanban/Calendar }`     | YAML `view` key                    |
| Cell value       | `CellPB { data: String }` — serialized per field type | CSV column value (string)          |

### Field types in AppFlowy (MVP-relevant subset)

| AppFlowy `FieldType` | Dart enum | Quartostone `type` |
| -------------------- | --------- | ------------------ |
| `RichText`           | 0         | `text`             |
| `Number`             | 1         | `number`           |
| `DateTime`           | 2         | `date`             |
| `SingleSelect`       | 3         | `single_select`    |
| `MultiSelect`        | 4         | `multi_select`     |
| `Checkbox`           | 5         | `checkbox`         |
| `URL`                | 6         | `url`              |

AppFlowy's single/multi-select fields carry an inline options list (`SelectOptionPB { id, name, color }`). Quartostone mirrors this as a `options` list under the field descriptor.

---

## Design: Quartostone Database Page Format

A database page is a standard `.qmd` file. The YAML front matter block carries the schema; the Quarto body is a Markdown table or a `:::` div fence that Quartostone's server recognises as a database block.

### File structure

```
---
title: "My Tasks"
quartostone:
  type: database
  version: 1
  view: grid              # grid | kanban | calendar
  fields:
    - id: f1
      name: Title
      type: text
      primary: true       # the "name" column shown in kanban cards
    - id: f2
      name: Status
      type: single_select
      options:
        - { id: o1, name: "To Do",       color: gray   }
        - { id: o2, name: "In Progress",  color: blue   }
        - { id: o3, name: "Done",         color: green  }
    - id: f3
      name: Due
      type: date
    - id: f4
      name: Priority
      type: single_select
      options:
        - { id: p1, name: High,   color: red    }
        - { id: p2, name: Medium, color: yellow }
        - { id: p3, name: Low,    color: gray   }
    - id: f5
      name: Done?
      type: checkbox
---

| f1      | f2 | f3         | f4 | f5  |
|---------|-----|------------|-----|-----|
| Task A  | o2  | 2025-08-01 | p1  | false |
| Task B  | o1  | 2025-08-10 | p2  | false |
| Task C  | o3  | 2025-07-20 | p3  | true  |
```

#### Rules

- **Column headers** are field IDs, not human names (the human name lives in the YAML schema). This keeps the markdown table machine-readable even after column renames.
- **Select cells** store the option `id`, not the display name. This survives option renames.
- **Date cells** use ISO 8601 (`YYYY-MM-DD`).
- **Checkbox cells** use literal `true` / `false`.
- **Multi-select cells** use a JSON array inside the cell: `["o1","o3"]`.
- **Number cells** store a raw number string (locale-independent, e.g. `3.14`).
- **Empty cell** = empty string in the CSV/table cell.
- The YAML `fields` list order determines default column order.
- The `primary: true` field is always the leftmost column and is required.

### Kanban and Calendar views

The `view` key in the front matter is the _default_ view. Kanban and Calendar are derived views — they do not change the underlying data; they change how Quartostone's client renders it.

| View       | Group-by                                                   | Sort                        |
| ---------- | ---------------------------------------------------------- | --------------------------- |
| `grid`     | —                                                          | natural row order           |
| `kanban`   | any `single_select` field (default: first `single_select`) | natural row order per group |
| `calendar` | any `date` field (default: first `date`)                   | ascending date              |

The active view and any column-width preferences are stored separately in a `.quartostone/views/<database-slug>.json` sidecar file (not in the `.qmd` content), so the content file stays VCS-clean.

---

## Server-side handling

| Endpoint                        | File change                                                    |
| ------------------------------- | -------------------------------------------------------------- |
| `GET /api/db/:path`             | Parse front matter + Markdown table; return `{ fields, rows }` |
| `PUT /api/db/:path/row`         | Append or update a row in the Markdown table                   |
| `DELETE /api/db/:path/row/:id`  | Remove a row                                                   |
| `PATCH /api/db/:path/field/:id` | Rename field, add/remove select options                        |

Row identity uses the `primary` field value as the natural key. If two rows have the same primary value, an auto-generated `_id` column (hidden) is injected by the server on first write.

---

## Options Considered

### Option A: CSV + sidecar YAML schema file

- **Pros**: Standard format; easy to read with any CSV tool
- **Cons**: Two files per database; schema and data diverge when one is edited outside Quartostone; complex VCS merges

### Option B: SQLite file (`.db`)

- **Pros**: Fast; ACID; mature query API
- **Cons**: Binary; not VCS-friendly; no plain-text editing; defeats the "Git-native" goal

### Option C: YAML front matter + Markdown table in `.qmd` ✅ Chosen

- **Pros**: Single file; readable in any text editor; renders beautifully in Quarto HTML output; VCS-diffable; schema and data colocated; consistent with the rest of Quartostone's file model
- **Cons**: Markdown table is row-order only (no index); parsing and writing require careful round-tripping; very large databases (10k+ rows) will have slow parse times — acceptable for knowledge-base use

---

## Decision

**Structured data pages use a `.qmd` file with YAML schema in the front matter and a Markdown table as the row store.**

The YAML `quartostone.type: database` key identifies database pages to Quartostone's server and client. All rendering views (grid, kanban, calendar) are computed client-side from the canonical row data.

---

## Consequences

- Database pages are valid Quarto documents; `quarto render` will produce a readable HTML table from them with no special treatment.
- Row storage in Markdown tables limits practical size to ~5,000 rows for interactive use (benchmark: parsing a 5,000-row table takes ~15 ms in Node.js with a regex-based parser).
- The server must implement a careful round-trip writer that preserves YAML front matter, column alignment, and trailing newlines.
- Multi-select values stored as JSON arrays (`["o1","o2"]`) inside a Markdown cell produce slightly ugly raw source; this is a known trade-off.
- Cross-database relations (linking rows from one database to another) are deferred to a later milestone.
