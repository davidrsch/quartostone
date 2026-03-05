// tests/unit/server/links.test.ts
// Unit tests for the wiki-link index and link-related API routes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createApp } from '../../../src/server/index.js';
import type { QuartostoneConfig } from '../../../src/server/config.js';
import {
  forwardLinks,
  pageMeta,
  rebuildLinkIndex,
  updateLinkIndexForFile,
  removeLinkIndexForFile,
  resetLinkIndex,
} from '../../../src/server/api/links.js';

// ── Standard config ───────────────────────────────────────────────────────────

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
  workspace = mkdtempSync(join(tmpdir(), 'qs-links-test-'));
  mkdirSync(join(workspace, 'pages'), { recursive: true });
  execSync('git init', { cwd: workspace });
  execSync('git config user.email "test@t.com"', { cwd: workspace });
  execSync('git config user.name "test"', { cwd: workspace });

  // Reset the full in-memory index (clears Maps + private _cachedPaths/_stemMap)
  resetLinkIndex();

  const app = createApp({ cwd: workspace, config: DEFAULT_CONFIG, port: 0 });
  client = supertest(app);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  resetLinkIndex();
});

// ── /api/links/backlinks ──────────────────────────────────────────────────────

describe('GET /api/links/backlinks', () => {
  it('returns 400 when path query param is missing', async () => {
    const res = await client.get('/api/links/backlinks');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('returns empty array when no pages link to the target', async () => {
    writeFileSync(join(workspace, 'pages', 'lonely.qmd'), '---\ntitle: Lonely\n---\nNo links.\n');
    rebuildLinkIndex(join(workspace, 'pages'));

    const res = await client.get('/api/links/backlinks?path=lonely.qmd');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns backlinks from pages that contain a [[wiki link]] to the target', async () => {
    writeFileSync(
      join(workspace, 'pages', 'source.qmd'),
      '---\ntitle: Source\n---\n\nSee also [[Target]].\n',
    );
    writeFileSync(
      join(workspace, 'pages', 'target.qmd'),
      '---\ntitle: Target\n---\n\nTarget contents.\n',
    );
    rebuildLinkIndex(join(workspace, 'pages'));

    const res = await client.get('/api/links/backlinks?path=target.qmd');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ path: 'source.qmd', title: 'Source' });
  });

  it('works with piped display text [[Target|Display]]', async () => {
    writeFileSync(
      join(workspace, 'pages', 'a.qmd'),
      '---\ntitle: A\n---\n\nVisit [[B|the B page]] for more.\n',
    );
    writeFileSync(
      join(workspace, 'pages', 'b.qmd'),
      '---\ntitle: B\n---\n\nB contents.\n',
    );
    rebuildLinkIndex(join(workspace, 'pages'));

    const res = await client.get('/api/links/backlinks?path=b.qmd');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ path: 'a.qmd' });
  });
});

// ── /api/links/forward ────────────────────────────────────────────────────────

describe('GET /api/links/forward', () => {
  it('returns 400 when path query param is missing', async () => {
    const res = await client.get('/api/links/forward');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('returns empty array when page has no outgoing wiki links', async () => {
    writeFileSync(join(workspace, 'pages', 'bare.qmd'), '---\ntitle: Bare\n---\nNo links.\n');
    rebuildLinkIndex(join(workspace, 'pages'));

    const res = await client.get('/api/links/forward?path=bare.qmd');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns the pages that a source page links to', async () => {
    writeFileSync(
      join(workspace, 'pages', 'hub.qmd'),
      '---\ntitle: Hub\n---\n\nSee [[Alpha]] and [[Beta]].\n',
    );
    writeFileSync(join(workspace, 'pages', 'alpha.qmd'), '---\ntitle: Alpha\n---\n\nAlpha.\n');
    writeFileSync(join(workspace, 'pages', 'beta.qmd'), '---\ntitle: Beta\n---\n\nBeta.\n');
    rebuildLinkIndex(join(workspace, 'pages'));

    const res = await client.get('/api/links/forward?path=hub.qmd');
    expect(res.status).toBe(200);
    const paths = (res.body as { path: string }[]).map(r => r.path).sort();
    expect(paths).toEqual(['alpha.qmd', 'beta.qmd']);
  });
});

// ── /api/links/graph ─────────────────────────────────────────────────────────

describe('GET /api/links/graph', () => {
  it('returns { nodes, edges } structure', async () => {
    writeFileSync(join(workspace, 'pages', 'page.qmd'), '---\ntitle: Page\n---\nContent.\n');
    rebuildLinkIndex(join(workspace, 'pages'));

    const res = await client.get('/api/links/graph');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('nodes');
    expect(res.body).toHaveProperty('edges');
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(Array.isArray(res.body.edges)).toBe(true);
  });

  it('includes inDegree, title, tags for each node', async () => {
    writeFileSync(
      join(workspace, 'pages', 'tagged.qmd'),
      '---\ntitle: Tagged\ntags: [foo, bar]\n---\nContent.\n',
    );
    rebuildLinkIndex(join(workspace, 'pages'));

    const res = await client.get('/api/links/graph');
    const node = (res.body.nodes as { id: string; title: string; tags: string[]; inDegree: number }[])
      .find(n => n.id === 'tagged.qmd');
    expect(node).toBeDefined();
    expect(node!.title).toBe('Tagged');
    expect(node!.tags).toContain('foo');
    expect(node!.inDegree).toBe(0);
  });

  it('reflects edges from [[wiki links]]', async () => {
    writeFileSync(
      join(workspace, 'pages', 'from.qmd'),
      '---\ntitle: From\n---\n\nSee [[To]].\n',
    );
    writeFileSync(join(workspace, 'pages', 'to.qmd'), '---\ntitle: To\n---\nHere.\n');
    rebuildLinkIndex(join(workspace, 'pages'));

    const res = await client.get('/api/links/graph');
    const edges = res.body.edges as { from: string; to: string }[];
    expect(edges.some(e => e.from === 'from.qmd' && e.to === 'to.qmd')).toBe(true);
    const toNode = (res.body.nodes as { id: string; inDegree: number }[])
      .find(n => n.id === 'to.qmd');
    expect(toNode!.inDegree).toBe(1);
  });
});

// ── /api/pages/search (autocomplete) ─────────────────────────────────────────

describe('GET /api/links/search', () => {
  beforeEach(() => {
    writeFileSync(
      join(workspace, 'pages', 'quantum.qmd'),
      '---\ntitle: Quantum Computing\n---\nContent.\n',
    );
    writeFileSync(
      join(workspace, 'pages', 'classical.qmd'),
      '---\ntitle: Classical Music\n---\nContent.\n',
    );
    rebuildLinkIndex(join(workspace, 'pages'));
  });

  it('returns all pages when no query given', async () => {
    const res = await client.get('/api/links/search');
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it('filters pages whose title or path match the query', async () => {
    const res = await client.get('/api/links/search?q=quantum');
    expect(res.status).toBe(200);
    const paths = (res.body as { path: string }[]).map(r => r.path);
    expect(paths).toContain('quantum.qmd');
    expect(paths).not.toContain('classical.qmd');
  });

  it('is case-insensitive', async () => {
    const res = await client.get('/api/links/search?q=QUANTUM');
    const paths = (res.body as { path: string }[]).map(r => r.path);
    expect(paths).toContain('quantum.qmd');
  });
});

// ── Index lifecycle helpers ───────────────────────────────────────────────────

describe('rebuildLinkIndex', () => {
  it('populates pageMeta for every .qmd file in the pages dir', () => {
    writeFileSync(join(workspace, 'pages', 'p1.qmd'), '---\ntitle: P1\n---\nHello.\n');
    writeFileSync(join(workspace, 'pages', 'p2.qmd'), '---\ntitle: P2\n---\nWorld.\n');
    rebuildLinkIndex(join(workspace, 'pages'));

    expect(pageMeta.has('p1.qmd')).toBe(true);
    expect(pageMeta.has('p2.qmd')).toBe(true);
    expect(pageMeta.get('p1.qmd')?.title).toBe('P1');
  });

  it('clears stale data on full rebuild', () => {
    writeFileSync(join(workspace, 'pages', 'old.qmd'), '---\ntitle: Old\n---\n');
    rebuildLinkIndex(join(workspace, 'pages'));
    expect(pageMeta.has('old.qmd')).toBe(true);

    // Remove file, rebuild — should not appear anymore
    rmSync(join(workspace, 'pages', 'old.qmd'));
    rebuildLinkIndex(join(workspace, 'pages'));
    expect(pageMeta.has('old.qmd')).toBe(false);
  });
});

describe('updateLinkIndexForFile', () => {
  it('adds a new file to the index without full rebuild', () => {
    rebuildLinkIndex(join(workspace, 'pages'));
    expect(pageMeta.size).toBe(0);

    writeFileSync(join(workspace, 'pages', 'new.qmd'), '---\ntitle: New Page\n---\nHello.\n');
    updateLinkIndexForFile(join(workspace, 'pages'), 'new.qmd');

    expect(pageMeta.has('new.qmd')).toBe(true);
    expect(pageMeta.get('new.qmd')?.title).toBe('New Page');
  });

  it('updates forward links when file content changes', () => {
    writeFileSync(join(workspace, 'pages', 'src.qmd'), '---\ntitle: Src\n---\nNo links.\n');
    writeFileSync(join(workspace, 'pages', 'dst.qmd'), '---\ntitle: Dst\n---\nDst.\n');
    rebuildLinkIndex(join(workspace, 'pages'));
    expect(forwardLinks.get('src.qmd')?.has('dst.qmd')).toBeFalsy();

    // Now update content to include a wiki link
    writeFileSync(
      join(workspace, 'pages', 'src.qmd'),
      '---\ntitle: Src\n---\n\nSee [[Dst]].\n',
    );
    updateLinkIndexForFile(join(workspace, 'pages'), 'src.qmd');

    expect(forwardLinks.get('src.qmd')?.has('dst.qmd')).toBe(true);
  });
});

describe('removeLinkIndexForFile', () => {
  it('removes a deleted file from the index', () => {
    writeFileSync(join(workspace, 'pages', 'doomed.qmd'), '---\ntitle: Doomed\n---\nBye.\n');
    rebuildLinkIndex(join(workspace, 'pages'));
    expect(pageMeta.has('doomed.qmd')).toBe(true);

    removeLinkIndexForFile('doomed.qmd');
    expect(pageMeta.has('doomed.qmd')).toBe(false);
    expect(forwardLinks.has('doomed.qmd')).toBe(false);
  });
});

// ── Duplicate wiki links ──────────────────────────────────────────────────────

describe('duplicate wiki links', () => {
  it('two [[same]] links in one page produce only one forward-link entry', () => {
    writeFileSync(
      join(workspace, 'pages', 'duplinks.qmd'),
      '---\ntitle: Dup Links\n---\n\nSee [[Alpha]] and [[Alpha]] again.\n',
    );
    writeFileSync(join(workspace, 'pages', 'alpha.qmd'), '---\ntitle: Alpha\n---\nAlpha.\n');
    rebuildLinkIndex(join(workspace, 'pages'));

    const links = forwardLinks.get('duplinks.qmd');
    expect(links).toBeDefined();
    // Set membership means duplicate targets collapse to one entry
    const alphaEntries = Array.from(links!).filter(l => l === 'alpha.qmd');
    expect(alphaEntries).toHaveLength(1);
  });
});

// ── updateLinkIndexForFile / removeLinkIndexForFile ───────────────────────────

describe('updateLinkIndexForFile / removeLinkIndexForFile', () => {
  it('updateLinkIndexForFile adds links to the index for a new file', () => {
    writeFileSync(join(workspace, 'pages', 'dest.qmd'), '---\ntitle: Dest\n---\nDest.\n');
    writeFileSync(
      join(workspace, 'pages', 'src.qmd'),
      '---\ntitle: Src\n---\n\nLinks to [[Dest]].\n',
    );

    updateLinkIndexForFile(join(workspace, 'pages'), 'src.qmd');

    expect(pageMeta.has('src.qmd')).toBe(true);
    expect(forwardLinks.get('src.qmd')?.has('dest.qmd')).toBe(true);
  });

  it('updateLinkIndexForFile replaces old links on second call — no accumulation', () => {
    writeFileSync(join(workspace, 'pages', 'a.qmd'), '---\ntitle: A\n---\nA.\n');
    writeFileSync(join(workspace, 'pages', 'b.qmd'), '---\ntitle: B\n---\nB.\n');
    writeFileSync(
      join(workspace, 'pages', 'hub.qmd'),
      '---\ntitle: Hub\n---\n\nSee [[A]].\n',
    );
    updateLinkIndexForFile(join(workspace, 'pages'), 'hub.qmd');
    expect(forwardLinks.get('hub.qmd')?.has('a.qmd')).toBe(true);
    expect(forwardLinks.get('hub.qmd')?.has('b.qmd')).toBeFalsy();

    // Edit hub to link to B instead of A
    writeFileSync(
      join(workspace, 'pages', 'hub.qmd'),
      '---\ntitle: Hub\n---\n\nSee [[B]].\n',
    );
    updateLinkIndexForFile(join(workspace, 'pages'), 'hub.qmd');

    // A should no longer appear — no accumulation of stale links
    expect(forwardLinks.get('hub.qmd')?.has('a.qmd')).toBeFalsy();
    expect(forwardLinks.get('hub.qmd')?.has('b.qmd')).toBe(true);
  });

  it('removeLinkIndexForFile removes all links and metadata for the given file', () => {
    writeFileSync(join(workspace, 'pages', 'target.qmd'), '---\ntitle: Target\n---\nT.\n');
    writeFileSync(
      join(workspace, 'pages', 'linker.qmd'),
      '---\ntitle: Linker\n---\n\nSee [[Target]].\n',
    );
    rebuildLinkIndex(join(workspace, 'pages'));

    expect(pageMeta.has('linker.qmd')).toBe(true);
    expect(forwardLinks.has('linker.qmd')).toBe(true);

    removeLinkIndexForFile('linker.qmd');

    expect(pageMeta.has('linker.qmd')).toBe(false);
    expect(forwardLinks.has('linker.qmd')).toBe(false);
  });
});
