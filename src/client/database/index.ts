// src/client/database/index.ts
// Structured data view — Table and Kanban modes for database .qmd pages
// #97: filter/sort toolbar   #98: column header editing (rename/type/delete/insert)

import { escHtml as esc } from '../utils/escape.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldDef {
  id: string;
  name: string;
  type: 'text' | 'select' | 'date' | 'checkbox' | 'number';
  options?: string[];
}

interface DbPage {
  schema: FieldDef[];
  rows: Record<string, string>[];
}

type ViewMode = 'table' | 'kanban';

// #97 — Filter / sort rule types
type FilterOp = 'contains' | 'equals' | 'is-blank' | 'is-checked' | 'gt' | 'lt';
interface FilterRule { fieldId: string; op: FilterOp; value: string; }
interface SortRule   { fieldId: string; dir: 'asc' | 'desc'; }

export interface DbInstance {
  destroy(): void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// #97 — Apply active filters and sorts to a row array, returning a new array
// with original indices preserved (needed for edit callbacks).
function applyFiltersAndSorts(
  rows: Record<string, string>[],
  filters: FilterRule[],
  sorts: SortRule[],
): { row: Record<string, string>; originalIdx: number }[] {
  let indexed = rows.map((row, i) => ({ row, originalIdx: i }));

  // Filter
  for (const f of filters) {
    indexed = indexed.filter(({ row }) => {
      const val = (row[f.fieldId] ?? '').toLowerCase();
      switch (f.op) {
        case 'contains':   return val.includes(f.value.toLowerCase());
        case 'equals':     return val === f.value.toLowerCase();
        case 'is-blank':   return val === '';
        case 'is-checked': return val === 'true';
        case 'gt':         return parseFloat(val) > parseFloat(f.value);
        case 'lt':         return parseFloat(val) < parseFloat(f.value);
        default:           return true;
      }
    });
  }

  // Sort (stable, last sort rule wins in reverse order of application)
  if (sorts.length > 0) {
    indexed.sort((a, b) => {
      for (const s of sorts) {
        const av = (a.row[s.fieldId] ?? '').toLowerCase();
        const bv = (b.row[s.fieldId] ?? '').toLowerCase();
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        if (cmp !== 0) return s.dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  return indexed;
}

// ── Filter/Sort UI dialogs ────────────────────────────────────────────────────

function showFilterDialog(
  schema: FieldDef[],
  activeFilters: FilterRule[],
  onApply: (filters: FilterRule[]) => void,
): void {
  const dlg = document.createElement('dialog');
  dlg.className = 'db-dialog';

  function buildRows(filters: FilterRule[]): string {
    return filters.map((f, i) => `
      <div class="db-filter-row" data-idx="${i}">
        <select class="db-filter-field" data-idx="${i}">
          ${schema.map(fd => `<option value="${esc(fd.id)}"${fd.id === f.fieldId ? ' selected' : ''}>${esc(fd.name)}</option>`).join('')}
        </select>
        <select class="db-filter-op" data-idx="${i}">
          <option value="contains" ${f.op === 'contains' ? 'selected' : ''}>contains</option>
          <option value="equals" ${f.op === 'equals' ? 'selected' : ''}>equals</option>
          <option value="is-blank" ${f.op === 'is-blank' ? 'selected' : ''}>is blank</option>
          <option value="is-checked" ${f.op === 'is-checked' ? 'selected' : ''}>is checked</option>
          <option value="gt" ${f.op === 'gt' ? 'selected' : ''}>&gt;</option>
          <option value="lt" ${f.op === 'lt' ? 'selected' : ''}>&lt;</option>
        </select>
        <input class="db-filter-val" type="text" value="${esc(f.value)}" placeholder="value" data-idx="${i}" />
        <button class="db-filter-del" data-idx="${i}" title="Remove">✕</button>
      </div>
    `).join('');
  }

  const working: FilterRule[] = activeFilters.map(f => ({ ...f }));

  function refresh() {
    const container = dlg.querySelector<HTMLElement>('.db-filter-rows')!;
    container.innerHTML = buildRows(working);
    container.querySelectorAll<HTMLButtonElement>('.db-filter-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset['idx'] ?? '0', 10);
        working.splice(i, 1);
        refresh();
      });
    });
  }

  dlg.innerHTML = `
    <h3>Filter</h3>
    <div class="db-filter-rows"></div>
    <button class="db-filter-add-btn" type="button">+ Add filter</button>
    <div class="dialog-actions">
      <button id="db-filter-apply">Apply</button>
      <button id="db-filter-clear">Clear all</button>
      <button id="db-filter-cancel">Cancel</button>
    </div>
  `;

  document.body.appendChild(dlg);
  dlg.showModal();
  refresh();

  dlg.querySelector('.db-filter-add-btn')?.addEventListener('click', () => {
    working.push({ fieldId: schema[0]?.id ?? '', op: 'contains', value: '' });
    refresh();
  });

  dlg.querySelector('#db-filter-apply')?.addEventListener('click', () => {
    // Read current values from inputs
    const rows = dlg.querySelectorAll<HTMLElement>('.db-filter-row');
    const result: FilterRule[] = [];
    rows.forEach(row => {
      const field = row.querySelector<HTMLSelectElement>('.db-filter-field')?.value ?? '';
      const op = (row.querySelector<HTMLSelectElement>('.db-filter-op')?.value ?? 'contains') as FilterOp;
      const value = row.querySelector<HTMLInputElement>('.db-filter-val')?.value ?? '';
      if (field) result.push({ fieldId: field, op, value });
    });
    dlg.close(); dlg.remove();
    onApply(result);
  });

  dlg.querySelector('#db-filter-clear')?.addEventListener('click', () => {
    dlg.close(); dlg.remove();
    onApply([]);
  });

  dlg.querySelector('#db-filter-cancel')?.addEventListener('click', () => {
    dlg.close(); dlg.remove();
  });
}

function showSortDialog(
  schema: FieldDef[],
  activeSorts: SortRule[],
  onApply: (sorts: SortRule[]) => void,
): void {
  const dlg = document.createElement('dialog');
  dlg.className = 'db-dialog';

  const working: SortRule[] = activeSorts.map(s => ({ ...s }));

  function buildRows(): string {
    return working.map((s, i) => `
      <div class="db-sort-row" data-idx="${i}">
        <select class="db-sort-field" data-idx="${i}">
          ${schema.map(fd => `<option value="${esc(fd.id)}"${fd.id === s.fieldId ? ' selected' : ''}>${esc(fd.name)}</option>`).join('')}
        </select>
        <select class="db-sort-dir" data-idx="${i}">
          <option value="asc" ${s.dir === 'asc' ? 'selected' : ''}>A → Z</option>
          <option value="desc" ${s.dir === 'desc' ? 'selected' : ''}>Z → A</option>
        </select>
        <button class="db-sort-del" data-idx="${i}" title="Remove">✕</button>
      </div>
    `).join('');
  }

  function refresh() {
    const container = dlg.querySelector<HTMLElement>('.db-sort-rows')!;
    container.innerHTML = buildRows();
    container.querySelectorAll<HTMLButtonElement>('.db-sort-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset['idx'] ?? '0', 10);
        working.splice(i, 1);
        refresh();
      });
    });
  }

  dlg.innerHTML = `
    <h3>Sort</h3>
    <div class="db-sort-rows"></div>
    <button class="db-sort-add-btn" type="button">+ Add sort</button>
    <div class="dialog-actions">
      <button id="db-sort-apply">Apply</button>
      <button id="db-sort-clear">Clear all</button>
      <button id="db-sort-cancel">Cancel</button>
    </div>
  `;

  document.body.appendChild(dlg);
  dlg.showModal();
  refresh();

  dlg.querySelector('.db-sort-add-btn')?.addEventListener('click', () => {
    working.push({ fieldId: schema[0]?.id ?? '', dir: 'asc' });
    refresh();
  });

  dlg.querySelector('#db-sort-apply')?.addEventListener('click', () => {
    const rows = dlg.querySelectorAll<HTMLElement>('.db-sort-row');
    const result: SortRule[] = [];
    rows.forEach(row => {
      const field = row.querySelector<HTMLSelectElement>('.db-sort-field')?.value ?? '';
      const dir = (row.querySelector<HTMLSelectElement>('.db-sort-dir')?.value ?? 'asc') as 'asc' | 'desc';
      if (field) result.push({ fieldId: field, dir });
    });
    dlg.close(); dlg.remove();
    onApply(result);
  });

  dlg.querySelector('#db-sort-clear')?.addEventListener('click', () => {
    dlg.close(); dlg.remove();
    onApply([]);
  });

  dlg.querySelector('#db-sort-cancel')?.addEventListener('click', () => {
    dlg.close(); dlg.remove();
  });
}

// ── Column header context menu (#98) ─────────────────────────────────────────

function showColumnMenu(
  anchorEl: HTMLElement,
  fieldIndex: number,
  schema: FieldDef[],
  onRename: (idx: number, newName: string) => void,
  onChangeType: (idx: number, newType: FieldDef['type'], options?: string[]) => void,
  onDelete: (idx: number) => void,
  onInsert: (idx: number, direction: 'left' | 'right') => void,
): void {
  // Close any existing column menu
  document.querySelector('.db-col-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'db-col-menu';

  const items: { label: string; action: () => void; danger?: boolean }[] = [
    {
      label: '✎ Rename', action: () => {
        menu.remove();
        const field = schema[fieldIndex];
        if (!field) return;
        const newName = prompt('Rename field:', field.name);
        if (newName && newName.trim() && newName.trim() !== field.name) {
          onRename(fieldIndex, newName.trim());
        }
      }
    },
    {
      label: '⇄ Change type', action: () => {
        menu.remove();
        showChangeTypeDialog(fieldIndex, schema[fieldIndex], onChangeType);
      }
    },
    { label: '← Insert left',  action: () => { menu.remove(); onInsert(fieldIndex, 'left');  } },
    { label: '→ Insert right', action: () => { menu.remove(); onInsert(fieldIndex, 'right'); } },
    { label: '🗑 Delete field', danger: true, action: () => {
        menu.remove();
        if (schema.length <= 1) { alert('Cannot delete the last field.'); return; }
        if (confirm(`Delete field "${schema[fieldIndex]?.name ?? ''}"?`)) {
          onDelete(fieldIndex);
        }
      }
    },
  ];

  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = `db-col-menu-item${item.danger ? ' danger' : ''}`;
    btn.textContent = item.label;
    btn.addEventListener('click', item.action);
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  const rect = anchorEl.getBoundingClientRect();
  menu.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom + 2}px`;

  setTimeout(() => {
    document.addEventListener('mousedown', (e) => {
      if (!menu.contains(e.target as Node)) menu.remove();
    }, { once: true });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.remove();
    }, { once: true });
  }, 0);
}

function showChangeTypeDialog(
  fieldIndex: number,
  field: FieldDef,
  onConfirm: (idx: number, type: FieldDef['type'], options?: string[]) => void,
): void {
  const dlg = document.createElement('dialog');
  dlg.className = 'db-dialog';
  dlg.innerHTML = `
    <h3>Change field type</h3>
    <label>Type<br>
      <select id="db-ct-type">
        <option value="text" ${field.type === 'text' ? 'selected' : ''}>Text</option>
        <option value="select" ${field.type === 'select' ? 'selected' : ''}>Select</option>
        <option value="date" ${field.type === 'date' ? 'selected' : ''}>Date</option>
        <option value="number" ${field.type === 'number' ? 'selected' : ''}>Number</option>
        <option value="checkbox" ${field.type === 'checkbox' ? 'selected' : ''}>Checkbox</option>
      </select>
    </label>
    <div id="db-ct-opts-row" class="${field.type === 'select' ? '' : 'hidden'}">
      <label>Options (comma-separated)<br>
        <input id="db-ct-options" type="text" value="${esc((field.options ?? []).join(', '))}" placeholder="Todo, Doing, Done" />
      </label>
    </div>
    <div class="dialog-actions">
      <button id="db-ct-confirm">Change</button>
      <button id="db-ct-cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();

  const typeEl = dlg.querySelector<HTMLSelectElement>('#db-ct-type')!;
  const optsRow = dlg.querySelector<HTMLElement>('#db-ct-opts-row')!;
  typeEl.addEventListener('change', () => {
    optsRow.classList.toggle('hidden', typeEl.value !== 'select');
  });

  dlg.querySelector('#db-ct-cancel')?.addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.querySelector('#db-ct-confirm')?.addEventListener('click', () => {
    const type = typeEl.value as FieldDef['type'];
    const rawOpts = dlg.querySelector<HTMLInputElement>('#db-ct-options')?.value ?? '';
    const options = type === 'select' ? rawOpts.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    dlg.close(); dlg.remove();
    onConfirm(fieldIndex, type, options);
  });
}

function cellEditor(field: FieldDef, value: string): string {
  switch (field.type) {
    case 'select': {
      const opts = (field.options ?? [])
        .map(o => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`)
        .join('');
      return `<select data-field="${esc(field.id)}" class="db-cell-select">
        <option value=""></option>${opts}
      </select>`;
    }
    case 'date':
      return `<input type="date" data-field="${esc(field.id)}" class="db-cell-input" value="${esc(value)}" />`;
    case 'checkbox':
      return `<input type="checkbox" data-field="${esc(field.id)}" class="db-cell-check"${value === 'true' ? ' checked' : ''} />`;
    case 'number':
      return `<input type="number" data-field="${esc(field.id)}" class="db-cell-input" value="${esc(value)}" />`;
    default:
      return `<input type="text" data-field="${esc(field.id)}" class="db-cell-input" value="${esc(value)}" />`;
  }
}

// ── Table view ────────────────────────────────────────────────────────────────

function renderTableView(
  el: HTMLElement,
  db: DbPage,
  activeFilters: FilterRule[],
  activeSorts: SortRule[],
  onCellChange: (rowIdx: number, fieldId: string, value: string) => void,
  onAddRow: () => void,
  onDeleteRow: (rowIdx: number) => void,
  onAddColumn: () => void,
  onRenameField: (fi: number, name: string) => void,
  onChangeFieldType: (fi: number, type: FieldDef['type'], opts?: string[]) => void,
  onDeleteField: (fi: number) => void,
  onInsertField: (fi: number, dir: 'left' | 'right') => void,
  onFilterChange: (filters: FilterRule[]) => void,
  onSortChange: (sorts: SortRule[]) => void,
) {
  const { schema } = db;
  const visibleRows = applyFiltersAndSorts(db.rows, activeFilters, activeSorts);

  // Filter/sort chip summary for toolbar
  const filterChips = activeFilters.map(f => {
    const fname = schema.find(fd => fd.id === f.fieldId)?.name ?? f.fieldId;
    return `<span class="db-chip db-chip-filter">${esc(fname)} ${f.op} "${esc(f.value)}"</span>`;
  }).join('');
  const sortChips = activeSorts.map(s => {
    const fname = schema.find(fd => fd.id === s.fieldId)?.name ?? s.fieldId;
    return `<span class="db-chip db-chip-sort">${esc(fname)} ${s.dir === 'asc' ? '↑' : '↓'}</span>`;
  }).join('');

  const hasActiveFilters = activeFilters.length > 0;
  const hasActiveSorts   = activeSorts.length > 0;

  el.innerHTML = `
    <div class="db-toolbar">
      <button class="db-toolbar-btn${hasActiveFilters ? ' active' : ''}" id="db-btn-filter">⚐ Filter${hasActiveFilters ? ` (${activeFilters.length})` : ''}</button>
      <button class="db-toolbar-btn${hasActiveSorts ? ' active' : ''}" id="db-btn-sort">↕ Sort${hasActiveSorts ? ` (${activeSorts.length})` : ''}</button>
      <div class="db-chips">${filterChips}${sortChips}</div>
    </div>
    <div class="db-table-wrapper">
      <table class="db-table">
        <thead>
          <tr>
            ${schema.map((f, fi) => `
              <th class="db-th" data-fid="${esc(f.id)}">
                <span class="db-th-label">${esc(f.name)}</span>
                <button class="db-th-menu-btn" data-fi="${fi}" title="Column options">▾</button>
              </th>`).join('')}
            <th class="db-th-actions"></th>
          </tr>
        </thead>
        <tbody>
          ${visibleRows.map(({ row, originalIdx: ri }) => `
            <tr data-row="${ri}">
              ${schema.map(f => `<td>${cellEditor(f, row[f.id] ?? '')}</td>`).join('')}
              <td><button class="db-btn-del-row" data-row="${ri}" title="Delete row">✕</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="db-table-footer">
        <button class="db-btn-add-row">+ Add row</button>
        <button class="db-btn-add-col">+ Add field</button>
      </div>
    </div>
  `;

  // Filter / sort toolbar buttons
  el.querySelector('#db-btn-filter')?.addEventListener('click', () => {
    showFilterDialog(schema, activeFilters, onFilterChange);
  });
  el.querySelector('#db-btn-sort')?.addEventListener('click', () => {
    showSortDialog(schema, activeSorts, onSortChange);
  });

  // Column header menu buttons (#98)
  el.querySelectorAll<HTMLButtonElement>('.db-th-menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fi = parseInt(btn.dataset['fi'] ?? '0', 10);
      showColumnMenu(btn, fi, schema, onRenameField, onChangeFieldType, onDeleteField, onInsertField);
    });
  });

  // Cell change listeners
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach(input => {
    const tr = input.closest<HTMLElement>('tr[data-row]');
    if (!tr) return;
    const rowIdx = parseInt(tr.dataset['row'] ?? '0', 10);
    const fieldId = input.dataset['field'] ?? '';

    if (input.type === 'checkbox') {
      input.addEventListener('change', () => {
        onCellChange(rowIdx, fieldId, (input as HTMLInputElement).checked ? 'true' : 'false');
      });
    } else {
      input.addEventListener('change', () => { onCellChange(rowIdx, fieldId, input.value); });
      input.addEventListener('blur',   () => { onCellChange(rowIdx, fieldId, input.value); });
    }
  });

  el.querySelectorAll<HTMLButtonElement>('.db-btn-del-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const ri = parseInt(btn.dataset['row'] ?? '0', 10);
      onDeleteRow(ri);
    });
  });

  el.querySelector('.db-btn-add-row')?.addEventListener('click', onAddRow);
  el.querySelector('.db-btn-add-col')?.addEventListener('click', onAddColumn);
}

// ── Kanban view ───────────────────────────────────────────────────────────────

function renderKanbanView(
  el: HTMLElement,
  db: DbPage,
  onMoveCard: (rowIdx: number, newValue: string) => void,
  onAddCard: (columnValue: string) => void,
) {
  const { schema, rows } = db;

  // Find first select field
  const groupField = schema.find(f => f.type === 'select');
  if (!groupField) {
    el.innerHTML = '<div class="db-kanban-no-select">Add a <em>select</em> field to enable Kanban view.</div>';
    return;
  }

  const columns = ['', ...(groupField.options ?? [])];

  const colsHtml = columns.map(col => {
    const colLabel = col || 'No status';
    const colRows  = rows.map((r, i) => ({ r, i })).filter(({ r }) => (r[groupField.id] ?? '') === col);
    const cardsHtml = colRows.map(({ r, i }) => {
      const nameField = schema.find(f => f.type === 'text');
      const title = nameField ? (r[nameField.id] ?? '') : Object.values(r)[0] ?? '';
      return `<div class="db-kanban-card" draggable="true" data-row="${i}" data-col="${esc(col)}">
        <div class="db-card-title">${esc(title) || '<em>Untitled</em>'}</div>
        ${schema.filter(f => f.id !== nameField?.id && f.id !== groupField.id).slice(0, 2).map(f =>
          `<div class="db-card-meta">${esc(f.name)}: ${esc(r[f.id] ?? '')}</div>`
        ).join('')}
      </div>`;
    }).join('');

    return `<div class="db-kanban-column" data-col="${esc(col)}">
      <div class="db-kanban-col-header">
        <span class="db-col-label">${esc(colLabel)}</span>
        <span class="db-col-count">${colRows.length}</span>
      </div>
      <div class="db-kanban-cards" data-col="${esc(col)}">${cardsHtml}</div>
      <button class="db-btn-add-card" data-col="${esc(col)}">+ Add</button>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="db-kanban-board">${colsHtml}</div>`;

  // Drag-and-drop
  let dragRowIdx = -1;

  el.querySelectorAll<HTMLElement>('.db-kanban-card').forEach(card => {
    card.addEventListener('dragstart', () => {
      dragRowIdx = parseInt(card.dataset['row'] ?? '-1', 10);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); });
  });

  el.querySelectorAll<HTMLElement>('.db-kanban-cards').forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave',  () => { zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', () => {
      zone.classList.remove('drag-over');
      if (dragRowIdx < 0) return;
      const newValue = zone.dataset['col'] ?? '';
      onMoveCard(dragRowIdx, newValue);
      dragRowIdx = -1;
    });
  });

  el.querySelectorAll<HTMLButtonElement>('.db-btn-add-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.dataset['col'] ?? '';
      onAddCard(col);
    });
  });
}

// ── Add-column dialog ─────────────────────────────────────────────────────────

function showAddColumnDialog(
  onConfirm: (field: FieldDef) => void,
) {
  const dlg = document.createElement('dialog');
  dlg.className = 'db-dialog';
  dlg.innerHTML = `
    <h3>Add field</h3>
    <label>Name<br><input id="db-new-field-name" type="text" placeholder="Field name" /></label>
    <label>Type<br>
      <select id="db-new-field-type">
        <option value="text">Text</option>
        <option value="select">Select</option>
        <option value="date">Date</option>
        <option value="number">Number</option>
        <option value="checkbox">Checkbox</option>
      </select>
    </label>
    <div id="db-options-row" class="hidden">
      <label>Options (comma-separated)<br>
        <input id="db-new-field-options" type="text" placeholder="Todo, Doing, Done" />
      </label>
    </div>
    <div class="dialog-actions">
      <button id="db-btn-confirm">Add</button>
      <button id="db-btn-cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();

  const typeEl    = dlg.querySelector<HTMLSelectElement>('#db-new-field-type')!;
  const optRow    = dlg.querySelector<HTMLElement>('#db-options-row')!;

  typeEl.addEventListener('change', () => {
    optRow.classList.toggle('hidden', typeEl.value !== 'select');
  });

  dlg.querySelector('#db-btn-cancel')?.addEventListener('click', () => {
    dlg.close(); dlg.remove();
  });

  dlg.querySelector('#db-btn-confirm')?.addEventListener('click', () => {
    const name = (dlg.querySelector<HTMLInputElement>('#db-new-field-name')?.value ?? '').trim();
    if (!name) return;
    const type = typeEl.value as FieldDef['type'];
    const rawOpts = (dlg.querySelector<HTMLInputElement>('#db-new-field-options')?.value ?? '');
    const field: FieldDef = {
      id:   name.toLowerCase().replace(/\s+/g, '_'),
      name,
      type,
      options: type === 'select' ? rawOpts.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    };
    dlg.close(); dlg.remove();
    onConfirm(field);
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function initDatabaseView(
  containerEl: HTMLElement,
  pagePath: string,
): Promise<DbInstance | null> {
  // Fetch current data
  let db: DbPage;
  try {
    const res = await fetch(`/api/db?path=${encodeURIComponent(pagePath)}`);
    if (!res.ok) return null;
    db = await res.json() as DbPage;
  } catch {
    return null;
  }

  let currentView: ViewMode = 'table';
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  // #97 — Load persisted filter/sort state from localStorage
  const FILTER_KEY = `db-filter-${pagePath}`;
  const SORT_KEY   = `db-sort-${pagePath}`;
  let activeFilters: FilterRule[] = [];
  let activeSorts: SortRule[]     = [];
  try { activeFilters = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '[]') as FilterRule[]; } catch { /* ok */ }
  try { activeSorts   = JSON.parse(localStorage.getItem(SORT_KEY)   ?? '[]') as SortRule[];   } catch { /* ok */ }

  async function persistDb() {
    if (destroyed) return;
    try {
      await fetch(`/api/db?path=${encodeURIComponent(pagePath)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(db),
      });
    } catch { /* non-fatal */ }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistDb, 600);
  }

  function renderView() {
    viewContent.innerHTML = '';
    if (currentView === 'table') {
      renderTableView(
        viewContent, db, activeFilters, activeSorts,
        /* onCellChange */ (ri, fid, val) => { db.rows[ri][fid] = val; scheduleSave(); },
        /* onAddRow     */ () => {
          const empty: Record<string, string> = {};
          db.schema.forEach(f => { empty[f.id] = ''; });
          db.rows.push(empty);
          renderView(); scheduleSave();
        },
        /* onDeleteRow  */ (ri) => { db.rows.splice(ri, 1); renderView(); scheduleSave(); },
        /* onAddColumn  */ () => showAddColumnDialog(field => {
          db.schema.push(field);
          db.rows.forEach(r => { r[field.id] = ''; });
          renderView(); scheduleSave();
        }),
        /* onRenameField */ (fi, name) => {
          if (db.schema[fi]) { db.schema[fi].name = name; renderView(); scheduleSave(); }
        },
        /* onChangeFieldType */ (fi, type, opts) => {
          if (db.schema[fi]) {
            db.schema[fi].type = type;
            db.schema[fi].options = opts;
            renderView(); scheduleSave();
          }
        },
        /* onDeleteField */ (fi) => {
          const removed = db.schema.splice(fi, 1);
          if (removed.length) db.rows.forEach(r => { delete r[removed[0].id]; });
          renderView(); scheduleSave();
        },
        /* onInsertField */ (fi, dir) => {
          const idx = dir === 'left' ? fi : fi + 1;
          const newField: FieldDef = {
            id: `field_${Date.now()}`,
            name: 'New field',
            type: 'text',
          };
          db.schema.splice(idx, 0, newField);
          db.rows.forEach(r => { r[newField.id] = ''; });
          renderView(); scheduleSave();
        },
        /* onFilterChange */ (filters) => {
          activeFilters = filters;
          localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
          renderView();
        },
        /* onSortChange */ (sorts) => {
          activeSorts = sorts;
          localStorage.setItem(SORT_KEY, JSON.stringify(sorts));
          renderView();
        },
      );
    } else {
      renderKanbanView(
        viewContent, db,
        (ri, newVal) => {
          const gf = db.schema.find(f => f.type === 'select');
          if (!gf) return;
          db.rows[ri][gf.id] = newVal;
          renderView(); scheduleSave();
        },
        (colValue) => {
          const empty: Record<string, string> = {};
          db.schema.forEach(f => { empty[f.id] = ''; });
          const gf = db.schema.find(f => f.type === 'select');
          if (gf) empty[gf.id] = colValue;
          db.rows.push(empty);
          renderView(); scheduleSave();
        },
      );
    }
  }

  // Build the container
  containerEl.innerHTML = `
    <div class="db-header">
      <div class="db-view-switcher">
        <button class="db-view-btn active" data-view="table">▦ Table</button>
        <button class="db-view-btn" data-view="kanban">☰ Kanban</button>
      </div>
    </div>
    <div class="db-view-content"></div>
  `;

  const viewContent = containerEl.querySelector<HTMLElement>('.db-view-content')!;

  containerEl.querySelectorAll<HTMLButtonElement>('.db-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentView = btn.dataset['view'] as ViewMode;
      containerEl.querySelectorAll('.db-view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderView();
    });
  });

  renderView();

  return {
    destroy() {
      destroyed = true;
      if (saveTimer) { clearTimeout(saveTimer); persistDb(); }
    },
  };
}
