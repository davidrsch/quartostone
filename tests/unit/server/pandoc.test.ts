// tests/unit/server/pandoc.test.ts
// Integration-style tests for the /api/pandoc/* routes.
// These tests call the real pandoc binary; they are skipped when pandoc is not
// on the system PATH.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { execSync, spawnSync } from 'node:child_process';

// Mock node:child_process so we can intercept spawn in the "unavailable" tests.
// By default the mock delegates to the real spawn so existing pandoc tests are unaffected.
vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return {
    ...orig,
    spawn: vi.fn((...args: Parameters<typeof orig.spawn>) => orig.spawn(...args)),
  };
});

const { spawn } = await import('node:child_process');
const spawnMock = vi.mocked(spawn);

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';
import { resetCapabilitiesCache } from '../../../src/server/api/pandoc.js';

// ── Detect pandoc availability ────────────────────────────────────────────────

const pandocAvailable = (() => {
  try {
    const r = spawnSync('pandoc', ['--version'], { timeout: 5000 });
    return r.status === 0;
  } catch {
    return false;
  }
})();

// ── Config / setup ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: QuartostoneConfig = {
  commit_mode: 'prompt',
  commit_message_auto: 'qs-{alphanum8}',
  render_on_save: false,
  render_scope: 'file',
  watch_interval_ms: 300,
  port: 0,
  pages_dir: 'pages',
  open_browser: false,
  allow_code_execution: false,
};

let workspace: string;
let client: ReturnType<typeof supertest>;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qs-pandoc-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@t.com"', { cwd: workspace });
  execSync('git config user.name "test"', { cwd: workspace });
  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert markdown → JSON AST via the API */
async function markdownToAst(markdown: string, format = 'markdown') {
  const res = await client
    .post('/api/pandoc/markdownToAst')
    .send({ markdown, format, options: [] });
  expect(res.status).toBe(200);
  return res.body as { blocks: unknown[]; 'pandoc-api-version': number[]; meta: Record<string, unknown> };
}

/** Convert JSON AST → markdown via the API */
async function astToMarkdown(ast: unknown, format = 'markdown') {
  const res = await client
    .post('/api/pandoc/astToMarkdown')
    .send({ ast, format, options: [] });
  expect(res.status).toBe(200);
  return res.body as string;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe.skipIf(!pandocAvailable)('POST /api/pandoc/capabilities', () => {
  it('returns version string and numeric api_version array', async () => {
    const res = await client.post('/api/pandoc/capabilities').send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.api_version)).toBe(true);
    expect(res.body.api_version.every((n: unknown) => typeof n === 'number')).toBe(true);
  });

  it('returns non-empty output_formats and highlight_languages', async () => {
    const res = await client.post('/api/pandoc/capabilities').send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.output_formats).toBe('string');
    expect(res.body.output_formats.length).toBeGreaterThan(0);
    expect(typeof res.body.highlight_languages).toBe('string');
    expect(res.body.highlight_languages.length).toBeGreaterThan(0);
    // output_formats should contain well-known targets
    expect(res.body.output_formats).toContain('html');
    expect(res.body.output_formats).toContain('pdf');
  });
});

describe.skipIf(!pandocAvailable)('POST /api/pandoc/markdownToAst', () => {
  it('returns 400 when markdown is missing', async () => {
    const res = await client.post('/api/pandoc/markdownToAst').send({ format: 'markdown', options: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('converts a simple paragraph to a Pandoc JSON AST', async () => {
    const ast = await markdownToAst('Hello, world!');
    expect(ast.blocks).toBeDefined();
    expect(Array.isArray(ast.blocks)).toBe(true);
    expect(ast.blocks.length).toBeGreaterThan(0);
    expect(Array.isArray(ast['pandoc-api-version'])).toBe(true);
  });

  it('parses a heading and returns it in the blocks array', async () => {
    const ast = await markdownToAst('# Section One\n\nBody text.');
    const types = (ast.blocks as Array<{ t: string }>).map(b => b.t);
    expect(types).toContain('Header');
    expect(types).toContain('Para');
  });

  it('captures YAML frontmatter in the meta field', async () => {
    const md = `---\ntitle: My Document\nauthor: Alice\n---\n\nContent here.`;
    const ast = await markdownToAst(md, 'markdown+yaml_metadata_block');
    // meta should have at least title and author entries
    expect(Object.keys(ast.meta)).toContain('title');
    expect(Object.keys(ast.meta)).toContain('author');
  });

  it('preserves inline math as Math nodes', async () => {
    const ast = await markdownToAst('Euler: $e^{i\\pi} + 1 = 0$', 'markdown');
    const json = JSON.stringify(ast);
    expect(json).toContain('"Math"');
    // In the JSON text, a single backslash is encoded as \\, so \pi becomes \\pi
    expect(json).toContain('e^{i\\\\pi} + 1 = 0');
  });

  it('preserves fenced code block with python language tag', async () => {
    const md = '```python\nprint("hello")\n```';
    const ast = await markdownToAst(md);
    const json = JSON.stringify(ast);
    expect(json).toContain('"CodeBlock"');
    expect(json).toContain('python');
    expect(json).toContain('print');
  });
});

describe.skipIf(!pandocAvailable)('POST /api/pandoc/astToMarkdown', () => {
  it('returns 400 when ast is missing', async () => {
    const res = await client.post('/api/pandoc/astToMarkdown').send({ format: 'markdown', options: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('converts a trivial AST back to a string', async () => {
    // First get a real AST
    const ast = await markdownToAst('Hello world.');
    // Then convert it back
    const md = await astToMarkdown(ast, 'markdown');
    expect(typeof md).toBe('string');
    expect(md.trim().length).toBeGreaterThan(0);
    expect(md).toContain('Hello world');
  });
});

describe.skipIf(!pandocAvailable)('round-trip: markdown → AST → markdown', () => {
  async function roundTrip(input: string, fmt = 'markdown'): Promise<string> {
    const ast = await markdownToAst(input, fmt);
    return astToMarkdown(ast, fmt);
  }

  it('preserves a simple paragraph', async () => {
    const md = 'This is a paragraph.';
    const out = await roundTrip(md);
    expect(out.trim()).toContain('This is a paragraph.');
  });

  it('preserves a bullet list', async () => {
    const md = '- Alpha\n- Beta\n- Gamma\n';
    const out = await roundTrip(md);
    expect(out).toContain('Alpha');
    expect(out).toContain('Beta');
    expect(out).toContain('Gamma');
  });

  it('preserves inline math content', async () => {
    const md = 'The equation is $E = mc^2$.';
    const out = await roundTrip(md);
    expect(out).toContain('E = mc');
  });

  it('preserves fenced code block language', async () => {
    const md = '``` python\nprint("hello")\n```\n';
    const out = await roundTrip(md);
    expect(out).toContain('python');
    expect(out).toContain('print');
  });

  it('preserves YAML frontmatter title in the AST meta field', async () => {
    const md = '---\ntitle: My Note\n---\n\nBody text.\n';
    // markdownToAst should capture the YAML metadata in the "meta" field
    const ast = await markdownToAst(md, 'markdown+yaml_metadata_block');
    // The title field should be present in the meta
    expect(Object.keys(ast.meta)).toContain('title');
    // Pandoc splits "My Note" into Str/"My", Space, Str/"Note" inlines
    const json = JSON.stringify(ast.meta);
    expect(json).toContain('"My"');
    expect(json).toContain('"Note"');
  });

  it('preserves heading levels', async () => {
    const md = '# H1\n\n## H2\n\n### H3\n';
    const out = await roundTrip(md);
    expect(out).toContain('H1');
    expect(out).toContain('H2');
    expect(out).toContain('H3');
  });
});

describe.skipIf(!pandocAvailable)('POST /api/pandoc/listExtensions', () => {
  it('returns a non-empty list of markdown extensions', async () => {
    const res = await client.post('/api/pandoc/listExtensions').send({ format: 'markdown' });
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
    expect(res.body.length).toBeGreaterThan(0);
    // Should contain known extensions
    expect(res.body).toContain('yaml_metadata_block');
  });
});

describe.skipIf(!pandocAvailable)('POST /api/pandoc/getBibliography (stub)', () => {
  it('returns a stub bibliography result', async () => {
    const res = await client.post('/api/pandoc/getBibliography').send({
      file: null,
      bibliography: [],
      refBlock: null,
      etag: null,
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.etag).toBe('string');
    expect(Array.isArray(res.body.bibliography.sources)).toBe(true);
  });
});

describe('POST /api/pandoc/citationHTML (stub)', () => {
  it('returns an empty string stub with status 200', async () => {
    const res = await client.post('/api/pandoc/citationHTML').send({});
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
  });
});

// ── Pandoc unavailable path ────────────────────────────────────────────────────
// These tests do NOT require pandoc to be installed — they mock spawn to simulate
// ENOENT so we can verify the server responds with 503.

describe('when pandoc is not available', () => {
  beforeEach(() => {
    resetCapabilitiesCache(); // ensure module-level cache is cleared before running
    // Make every spawn call emit ENOENT to simulate "pandoc not on PATH"
    spawnMock.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.kill = vi.fn();
      setTimeout(() => {
        proc.emit('error', Object.assign(new Error('spawn pandoc ENOENT'), { code: 'ENOENT' }));
        setTimeout(() => proc.emit('close', 1), 10);
      }, 5);
      return proc as never;
    });
  });

  afterEach(() => {
    spawnMock.mockRestore();
  });

  it('POST /api/pandoc/capabilities returns 503', async () => {
    const res = await client.post('/api/pandoc/capabilities').send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/pandoc/i);
  });
});
