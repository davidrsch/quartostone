// src/client/database/index.ts
// Structured data view — Table and Kanban modes for database .qmd pages

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

export interface DbInstance {
  destroy(): void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
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
  onCellChange: (rowIdx: number, fieldId: string, value: string) => void,
  onAddRow: () => void,
  onDeleteRow: (rowIdx: number) => void,
  onAddColumn: () => void,
) {
  const { schema, rows } = db;

  el.innerHTML = `
    <div class="db-table-wrapper">
      <table class="db-table">
        <thead>
          <tr>
            ${schema.map(f => `<th>${esc(f.name)}</th>`).join('')}
            <th class="db-th-actions"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, ri) => `
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
        viewContent, db,
        (ri, fid, val) => { db.rows[ri][fid] = val; scheduleSave(); },
        () => {
          const empty: Record<string, string> = {};
          db.schema.forEach(f => { empty[f.id] = ''; });
          db.rows.push(empty);
          renderView(); scheduleSave();
        },
        (ri) => { db.rows.splice(ri, 1); renderView(); scheduleSave(); },
        () => showAddColumnDialog(field => {
          db.schema.push(field);
          db.rows.forEach(r => { r[field.id] = ''; });
          renderView(); scheduleSave();
        }),
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
