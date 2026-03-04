// src/client/properties/index.ts
// Page properties panel — reads and edits YAML frontmatter from editor content

import { escAttr } from '../utils/escape.js';

export interface PropertiesPanel {
  mount: (pagePath: string, getContent: () => string | Promise<string>, setContent: (s: string) => void) => void;
  unmount: () => void;
}

interface Frontmatter {
  [key: string]: unknown;
  title?: string;
  author?: string;
  date?: string;
  categories?: string[];
  description?: string;
  draft?: boolean;
  icon?: string;
}

// ─── Frontmatter parsing ──────────────────────────────────────────────────────

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export function parseFrontmatter(content: string): { fm: Frontmatter; body: string } {
  const m = FM_RE.exec(content);
  if (!m) return { fm: {}, body: content };
  const fm = parseYamlSimple(m[1]);
  const body = content.slice(m[0].length);
  return { fm, body };
}

/** Minimal YAML parser — handles string/bool/number scalars and simple lists */
function parseYamlSimple(yaml: string): Frontmatter {
  const out: Frontmatter = {};
  const lines = yaml.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([-_\w][\w-]*):\s*(.*)/);
    if (m) {
      const key = m[1];
      const val = m[2].trim();
      if (val === '[' || val === '') {
        // multi-line list
        const items: string[] = [];
        i++;
        while (i < lines.length && lines[i].trimStart().startsWith('-')) {
          items.push(lines[i].replace(/^\s*-\s*/, '').trim());
          i++;
        }
        out[key] = items;
        continue;
      } else if (val.startsWith('[') && val.endsWith(']')) {
        // inline list
        out[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      } else {
        out[key] = coerce(val);
      }
    }
    i++;
  }
  return out;
}

export function coerce(val: string): unknown {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (!isNaN(Number(val)) && val !== '') return Number(val);
  return val.replace(/^["']|["']$/g, '');
}

export function serializeFrontmatter(fm: Frontmatter): string {
  const lines: string[] = [];
  const order = ['title', 'author', 'date', 'description', 'categories', 'draft', 'icon'];
  const sorted = [...order.filter(k => k in fm), ...Object.keys(fm).filter(k => !order.includes(k))];

  for (const key of sorted) {
    const val = fm[key];
    if (val === undefined || val === null || val === '') continue;
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      lines.push(`${key}: [${val.map(v => `"${v}"`).join(', ')}]`);
    } else if (typeof val === 'string' && val.includes(':')) {
      lines.push(`${key}: "${val}"`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  return '---\n' + lines.join('\n') + '\n---';
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Frontmatter keys handled by the standard form fields. */
const STANDARD_KEYS = new Set(['title', 'author', 'date', 'description', 'categories', 'draft', 'icon']);

// ─── Panel factory ────────────────────────────────────────────────────────────

export function createPropertiesPanel(containerEl: HTMLElement): PropertiesPanel {
  let currentGet: (() => string | Promise<string>) | null = null;
  let currentSet: ((s: string) => void) | null = null;

  function mount(
    _pagePath: string,
    getContent: () => string | Promise<string>,
    setContent: (s: string) => void,
  ) {
    currentGet = getContent;
    currentSet = setContent;
    void render();
  }

  function unmount() {
    currentGet = null;
    currentSet = null;
    containerEl.innerHTML = '<p class="props-empty">No page open.</p>';
  }

  async function render() {
    if (!currentGet) return;
    const { fm } = parseFrontmatter(await currentGet());
    containerEl.innerHTML = '';
    containerEl.appendChild(buildForm(fm));
  }

  function buildForm(fm: Frontmatter): HTMLElement {
    const form = document.createElement('div');
    form.className = 'props-form';

    const save = async () => {
      if (!currentGet || !currentSet) return;
      const { body } = parseFrontmatter(await currentGet());
      const newFm = readForm(form);
      currentSet(serializeFrontmatter(newFm) + body);
    };

    form.append(
      iconField(String(fm.icon ?? '')),
      field('Title', 'text', 'title', String(fm.title ?? '')),
      field('Author', 'text', 'author', String(fm.author ?? '')),
      field('Description', 'text', 'description', String(fm.description ?? '')),
      field('Categories', 'text', 'categories',
        Array.isArray(fm.categories) ? fm.categories.join(', ') : String(fm.categories ?? '')),
      dateField(String(fm.date ?? '')),
      checkField('Draft', 'draft', fm.draft === true),
    );

    form.querySelectorAll<HTMLInputElement>('input').forEach(el => {
      el.addEventListener('change', save);
    });

    // ── Extra fields section ────────────────────────────────────────────────
    const separator = document.createElement('hr');
    separator.className = 'props-separator';
    form.appendChild(separator);

    const extraLabel = document.createElement('div');
    extraLabel.className = 'props-label';
    extraLabel.textContent = 'Extra fields';
    form.appendChild(extraLabel);

    // Render existing unknown keys from frontmatter
    for (const key of Object.keys(fm)) {
      if (STANDARD_KEYS.has(key)) continue;
      const val = fm[key];
      const valStr = Array.isArray(val) ? val.join(', ') : String(val ?? '');
      form.appendChild(makeExtraRow(key, valStr, save));
    }

    // "+ Add field" button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'props-add-btn';
    addBtn.textContent = '+ Add field';
    addBtn.addEventListener('click', () => {
      form.insertBefore(makeExtraRow('', '', save), addBtn);
    });
    form.appendChild(addBtn);

    return form;
  }

  return { mount, unmount };
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

function field(label: string, type: string, name: string, value: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'props-field';
  wrap.innerHTML = `
    <label class="props-label">${label}</label>
    <input class="props-input" type="${type}" name="${name}" value="${escAttr(value)}" autocomplete="off" />
  `;
  return wrap;
}

function checkField(label: string, name: string, checked: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'props-field props-field-check';
  wrap.innerHTML = `
    <label class="props-label">${label}</label>
    <input class="props-check" type="checkbox" name="${name}" ${checked ? 'checked' : ''} />
  `;
  return wrap;
}

/**
 * Date field — uses <input type="date"> for valid ISO dates and falls back to
 * <input type="text"> for special values like "today" or human-readable dates.
 * This prevents Quarto's `date: today` from being silently deleted on save.
 */
function dateField(value: string): HTMLElement {
  const isIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const type = (value === '' || isIsoDate) ? 'date' : 'text';
  return field('Date', type, 'date', value);
}

function readForm(form: HTMLElement): Frontmatter {
  const fm: Frontmatter = {};

  // Standard named fields
  form.querySelectorAll<HTMLInputElement>('input[name]').forEach(input => {
    const name = input.name as keyof Frontmatter;
    if (input.type === 'checkbox') {
      if (input.checked) fm[name] = true;
    } else {
      const val = input.value.trim();
      if (!val) return;
      if (name === 'categories') {
        fm[name] = val.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        fm[name] = val as never;
      }
    }
  });

  // Extra (custom) key/value rows
  form.querySelectorAll<HTMLElement>('.props-extra-row').forEach(row => {
    const keyInput = row.querySelector<HTMLInputElement>('.props-extra-key');
    const valInput = row.querySelector<HTMLInputElement>('.props-extra-val');
    if (!keyInput || !valInput) return;
    const k = keyInput.value.trim();
    const v = valInput.value.trim();
    if (!k) return;
    fm[k] = v;
  });

  return fm;
}

function makeExtraRow(
  key: string,
  val: string,
  save: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'props-extra-row';

  const head = document.createElement('div');
  head.className = 'props-extra-head';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'props-input props-extra-key';
  keyInput.placeholder = 'key';
  keyInput.value = key;
  keyInput.autocomplete = 'off';
  keyInput.setAttribute('aria-label', 'Field name');

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'props-del-btn';
  delBtn.title = 'Remove field';
  delBtn.textContent = '\u00d7';   // ×
  delBtn.addEventListener('click', () => {
    row.remove();
    save();
  });

  head.append(keyInput, delBtn);

  const valInput = document.createElement('input');
  valInput.type = 'text';
  valInput.className = 'props-input props-extra-val';
  valInput.placeholder = 'value';
  valInput.value = val;
  valInput.autocomplete = 'off';
  valInput.setAttribute('aria-label', 'Field value');

  keyInput.addEventListener('change', save);
  valInput.addEventListener('change', save);

  row.append(head, valInput);
  return row;
}

// ─── Icon field (#95) ─────────────────────────────────────────────────────────

let _propsPickerClose: ((e: MouseEvent) => void) | null = null;
let _propsPickerKeyDown: ((e: KeyboardEvent) => void) | null = null;

const PROPS_EMOJIS = [
  '📄','📝','📋','📌','📎','📃','📜','📑','🗒','🗓',
  '📅','📆','📊','📈','📉','🗃','🗂','📁','📂','🗄',
  '💡','⚡','🔧','🔨','⚙️','🛠','🔍','🔎','🔑','🗝',
  '🎯','🚀','✅','⭐','🌟','💎','🏆','💬','📰','📚',
  '🌍','🔗','💻','🎨','🎮','🌱','🌿','🍀','🦋','🐾',
];

function iconField(currentIcon: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'props-field props-field-icon';

  const label = document.createElement('label');
  label.className = 'props-label';
  label.textContent = 'Icon';

  const row = document.createElement('div');
  row.className = 'props-icon-row';

  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'props-icon-preview';
  preview.title = 'Click to change icon';
  preview.textContent = currentIcon || '📄';

  // Hidden input so readForm() picks up the value
  const hidden = document.createElement('input');
  hidden.type = 'text';
  hidden.name = 'icon';
  hidden.value = currentIcon;
  hidden.style.display = 'none';
  hidden.autocomplete = 'off';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'props-icon-clear';
  clearBtn.title = 'Clear icon';
  clearBtn.textContent = '✕';
  clearBtn.addEventListener('click', () => {
    preview.textContent = '📄';
    hidden.value = '';
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  });

  preview.addEventListener('click', () => {
    // Remove any lingering previous close listeners
    if (_propsPickerClose) {
      document.removeEventListener('mousedown', _propsPickerClose, { capture: true });
      _propsPickerClose = null;
    }
    if (_propsPickerKeyDown) {
      document.removeEventListener('keydown', _propsPickerKeyDown, { capture: true });
      _propsPickerKeyDown = null;
    }
    // Close any existing
    document.querySelector('.props-emoji-popover')?.remove();

    const popover = document.createElement('div');
    popover.className = 'emoji-picker-popover props-emoji-popover';

    const grid = document.createElement('div');
    grid.className = 'emoji-picker-grid';
    for (const e of PROPS_EMOJIS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-picker-btn';
      btn.textContent = e;
      btn.addEventListener('click', () => {
        preview.textContent = e;
        hidden.value = e;
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
        popover.remove();
        if (_propsPickerClose) {
          document.removeEventListener('mousedown', _propsPickerClose, { capture: true });
          _propsPickerClose = null;
        }
        if (_propsPickerKeyDown) {
          document.removeEventListener('keydown', _propsPickerKeyDown, { capture: true });
          _propsPickerKeyDown = null;
        }
      });
      grid.appendChild(btn);
    }
    popover.appendChild(grid);
    document.body.appendChild(popover);

    const rect = preview.getBoundingClientRect();
    popover.style.left = `${rect.left}px`;
    popover.style.top  = `${rect.bottom + 4}px`;

    const close = (ev: MouseEvent) => {
      if (!popover.contains(ev.target as Node)) {
        popover.remove();
        document.removeEventListener('mousedown', close, { capture: true });
        document.removeEventListener('keydown', handleKey, { capture: true });
        _propsPickerClose = null;
        _propsPickerKeyDown = null;
      }
    };
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        popover.remove();
        document.removeEventListener('mousedown', close, { capture: true });
        document.removeEventListener('keydown', handleKey, { capture: true });
        _propsPickerClose = null;
        _propsPickerKeyDown = null;
      }
    };
    _propsPickerClose = close;
    _propsPickerKeyDown = handleKey;
    setTimeout(() => {
      document.addEventListener('mousedown', close, { capture: true });
      document.addEventListener('keydown', handleKey, { capture: true });
    }, 0);
  });

  row.append(preview, clearBtn, hidden);
  wrap.append(label, row);
  return wrap;
}

