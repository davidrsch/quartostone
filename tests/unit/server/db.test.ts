// tests/unit/server/db.test.ts
// Unit tests for pure functions in src/server/api/db.ts
// These tests exercise file parsing and serialisation logic without any I/O.

import { describe, it, expect } from 'vitest';
import { parseDbFile, serialiseDbFile } from '../../../src/server/api/db.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_DB_QMD = `---
quartostone: database
schema:
  - id: name
    name: Name
    type: text
  - id: status
    name: Status
    type: select
    options:
      - Todo
      - Done
  - id: due
    name: Due
    type: date
---

| name    | status | due        |
|---------|--------|------------|
| Task A  | Todo   | 2026-03-01 |
| Task B  | Done   | 2026-02-15 |
`;

const NOT_A_DB_QMD = `---
title: Regular Page
---

# Just a regular page

Some content here.
`;

const NO_FRONTMATTER = `# Bare page

No YAML here.
`;

// ── parseDbFile ───────────────────────────────────────────────────────────────

describe('parseDbFile', () => {
  it('parses a valid database page and returns schema + rows', () => {
    const result = parseDbFile(VALID_DB_QMD);

    expect(result).not.toBeNull();
    expect(result!.schema).toHaveLength(3);
    expect(result!.rows).toHaveLength(2);
  });

  it('returns the correct field definitions', () => {
    const result = parseDbFile(VALID_DB_QMD)!;

    expect(result.schema[0]).toMatchObject({ id: 'name', name: 'Name', type: 'text' });
    expect(result.schema[1]).toMatchObject({
      id: 'status',
      name: 'Status',
      type: 'select',
      options: ['Todo', 'Done'],
    });
    expect(result.schema[2]).toMatchObject({ id: 'due', name: 'Due', type: 'date' });
  });

  it('returns the correct row data', () => {
    const result = parseDbFile(VALID_DB_QMD)!;

    expect(result.rows[0]).toMatchObject({ name: 'Task A', status: 'Todo', due: '2026-03-01' });
    expect(result.rows[1]).toMatchObject({ name: 'Task B', status: 'Done', due: '2026-02-15' });
  });

  it('returns null when quartostone frontmatter is not "database"', () => {
    expect(parseDbFile(NOT_A_DB_QMD)).toBeNull();
  });

  it('returns null for a file with no frontmatter', () => {
    expect(parseDbFile(NO_FRONTMATTER)).toBeNull();
  });

  it('parses a database page with no rows', () => {
    const content = `---
quartostone: database
schema:
  - id: title
    name: Title
    type: text
---

| title |
|-------|
`;
    const result = parseDbFile(content);
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(0);
  });
});

// ── serialiseDbFile ───────────────────────────────────────────────────────────

describe('serialiseDbFile', () => {
  it('serialises a database page to a string containing YAML frontmatter', () => {
    const page = {
      schema: [
        { id: 'name', name: 'Name', type: 'text' as const },
        { id: 'done', name: 'Done', type: 'checkbox' as const },
      ],
      rows: [{ name: 'Buy milk', done: 'true' }],
    };

    const output = serialiseDbFile(page);

    expect(output).toMatch(/^---\n/);
    expect(output).toContain('quartostone: database');
    expect(output).toContain('id: name');
    expect(output).toContain('Buy milk');
  });

  it('produces output that round-trips through parseDbFile', () => {
    const page = {
      schema: [
        { id: 'title', name: 'Title', type: 'text' as const },
        { id: 'status', name: 'Status', type: 'select' as const, options: ['Open', 'Closed'] },
      ],
      rows: [
        { title: 'Issue 1', status: 'Open' },
        { title: 'Issue 2', status: 'Closed' },
      ],
    };

    const serialised = serialiseDbFile(page);
    const reparsed = parseDbFile(serialised);

    expect(reparsed).not.toBeNull();
    expect(reparsed!.rows).toHaveLength(2);
    expect(reparsed!.rows[0]).toMatchObject({ title: 'Issue 1', status: 'Open' });
    expect(reparsed!.rows[1]).toMatchObject({ title: 'Issue 2', status: 'Closed' });
    expect(reparsed!.schema[1].options).toEqual(['Open', 'Closed']);
  });

  it('serialises a page with no rows to only a header + separator', () => {
    const page = {
      schema: [{ id: 'name', name: 'Name', type: 'text' as const }],
      rows: [],
    };
    const output = serialiseDbFile(page);
    // Should have frontmatter plus a table header — no data rows
    const lines = output.split('\n').filter(l => l.startsWith('|'));
    expect(lines).toHaveLength(2); // header + separator
  });
});

// ── normaliseSchema edge cases ────────────────────────────────────────────────

describe('normaliseSchema (via parseDbFile)', () => {
  it('normalises unknown field types to "text"', () => {
    const content = `---
quartostone: database
schema:
  - id: fancy
    name: Fancy
    type: unknown_type
---

| fancy |
|-------|
| hello |
`;
    const result = parseDbFile(content);
    expect(result).not.toBeNull();
    expect(result!.schema[0].type).toBe('text');
  });

  it('handles select fields with no options array', () => {
    const content = `---
quartostone: database
schema:
  - id: status
    name: Status
    type: select
---

| status |
|--------|
| active |
`;
    const result = parseDbFile(content);
    expect(result).not.toBeNull();
    expect(result!.schema[0].type).toBe('select');
    expect((result!.schema[0] as { options?: string[] }).options).toBeUndefined();
  });

  it('handles a db page with empty schema (no fields)', () => {
    const content = `---
quartostone: database
schema: []
---
`;
    const result = parseDbFile(content);
    expect(result).not.toBeNull();
    expect(result!.schema).toHaveLength(0);
    expect(result!.rows).toHaveLength(0);
  });
});

// ── pipe character escaping ───────────────────────────────────────────────────

describe('pipe character round-trip', () => {
  it('escapes pipe characters in cell content and restores them on parse', () => {
    const page = {
      schema: [{ id: 'notes', name: 'Notes', type: 'text' as const }],
      rows: [{ notes: 'A|B' }],
    };
    const serialised = serialiseDbFile(page);
    // The raw serialised content should contain the escaped form
    expect(serialised).toContain('A\\|B');
    // Parsing it back should restore the original value
    const reparsed = parseDbFile(serialised);
    expect(reparsed).not.toBeNull();
    expect(reparsed!.rows[0].notes).toBe('A|B');
  });
});
