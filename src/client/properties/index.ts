// src/client/properties/index.ts
// Page properties panel — reads and edits YAML frontmatter from editor content

export interface PropertiesPanel {
  mount: (pagePath: string, getContent: () => string, setContent: (s: string) => void) => void;
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
}

// ─── Frontmatter parsing ──────────────────────────────────────────────────────

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseFrontmatter(content: string): { fm: Frontmatter; body: string } {
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
    const m = line.match(/^(\w[\w-]*):\s*(.*)/);
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

function coerce(val: string): unknown {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (!isNaN(Number(val)) && val !== '') return Number(val);
  return val.replace(/^["']|["']$/g, '');
}

function serializeFrontmatter(fm: Frontmatter): string {
  const lines: string[] = [];
  const order = ['title', 'author', 'date', 'description', 'categories', 'draft'];
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
const STANDARD_KEYS = new Set(['title', 'author', 'date', 'description', 'categories', 'draft']);

// ─── Panel factory ────────────────────────────────────────────────────────────

export function createPropertiesPanel(containerEl: HTMLElement): PropertiesPanel {
  let currentGet: (() => string) | null = null;
  let currentSet: ((s: string) => void) | null = null;

  function mount(
    _pagePath: string,
    getContent: () => string,
    setContent: (s: string) => void,
  ) {
    currentGet = getContent;
    currentSet = setContent;
    render();
  }

  function unmount() {
    currentGet = null;
    currentSet = null;
    containerEl.innerHTML = '<p class="props-empty">No page open.</p>';
  }

  function render() {
    if (!currentGet) return;
    const { fm } = parseFrontmatter(currentGet());
    containerEl.innerHTML = '';
    containerEl.appendChild(buildForm(fm));
  }

  function buildForm(fm: Frontmatter): HTMLElement {
    const form = document.createElement('div');
    form.className = 'props-form';

    const save = () => {
      if (!currentGet || !currentSet) return;
      const { body } = parseFrontmatter(currentGet());
      const newFm = readForm(form);
      currentSet(serializeFrontmatter(newFm) + body);
    };

    form.append(
      field('Title', 'text', 'title', String(fm.title ?? '')),
      field('Author', 'text', 'author', String(fm.author ?? '')),
      field('Date', 'date', 'date', String(fm.date ?? '')),
      field('Description', 'text', 'description', String(fm.description ?? '')),
      field('Categories', 'text', 'categories',
        Array.isArray(fm.categories) ? fm.categories.join(', ') : String(fm.categories ?? '')),
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

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
