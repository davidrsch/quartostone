// src/client/visual/pandocServer.ts
// Client-side implementation of PandocServer + full EditorServer stub.
// PandocServer methods POST to /api/pandoc/* routes (see src/server/api/pandoc.ts).
// All other EditorServer sub-servers (DOI, CrossRef, etc.) are no-ops.

// ── Pandoc types (mirrored from editor-types/pandoc) ─────────────────────────

export interface PandocCapabilitiesResult {
  version: string;
  api_version: number[];
  output_formats: string;
  highlight_languages: string;
}

export interface PandocAst {
  blocks: unknown[];
  'pandoc-api-version': number[];
  meta: Record<string, unknown>;
  heading_ids?: string[];
}

export interface BibliographyResult {
  etag: string;
  bibliography: { sources: unknown[]; project_biblios: unknown[] };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(detail.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── PandocServer implementation ───────────────────────────────────────────────

export const pandocServer = {
  async getCapabilities(): Promise<PandocCapabilitiesResult> {
    return apiPost<PandocCapabilitiesResult>('/api/pandoc/capabilities', {});
  },

  async markdownToAst(markdown: string, format: string, options: string[]): Promise<PandocAst> {
    return apiPost<PandocAst>('/api/pandoc/markdownToAst', { markdown, format, options });
  },

  async astToMarkdown(ast: PandocAst, format: string, options: string[]): Promise<string> {
    return apiPost<string>('/api/pandoc/astToMarkdown', { ast, format, options });
  },

  async listExtensions(format: string): Promise<string> {
    return apiPost<string>('/api/pandoc/listExtensions', { format });
  },

  async getBibliography(
    file: string | null,
    bibliography: string[],
    refBlock: string | null,
    etag: string | null,
  ): Promise<BibliographyResult> {
    return apiPost<BibliographyResult>('/api/pandoc/getBibliography', {
      file,
      bibliography,
      refBlock,
      etag,
    });
  },

  async addToBibliography(
    bibliography: string,
    project: boolean,
    id: string,
    sourceAsJson: string,
    sourceAsBibTeX: string,
    documentPath: string | null,
  ): Promise<boolean> {
    return apiPost<boolean>('/api/pandoc/addToBibliography', {
      bibliography,
      project,
      id,
      sourceAsJson,
      sourceAsBibTeX,
      documentPath,
    });
  },

  async citationHTML(
    file: string | null,
    sourceAsJson: string,
    csl: string | null,
  ): Promise<string> {
    return apiPost<string>('/api/pandoc/citationHTML', { file, sourceAsJson, csl });
  },
};

// ── Stub sub-servers (DOI, CrossRef, etc.) ────────────────────────────────────

function notImpl(name: string) {
  return async (..._args: unknown[]) => {
    console.debug(`EditorServer.${name} not implemented`);
    return null;
  };
}

const doiServer = {
  fetchCSL: notImpl('doi.fetchCSL'),
};

const crossrefServer = {
  works: notImpl('crossref.works'),
  doi: notImpl('crossref.doi'),
};

const dataciteServer = {
  works: notImpl('datacite.works'),
};

const pubmedServer = {
  search: notImpl('pubmed.search'),
  fetchById: notImpl('pubmed.fetchById'),
};

const xrefServer = {
  quartoXrefTypes: async () => [],
  quartoXrefs: async () => ({ refs: [] }),
  xrefIndexForFile: async () => ({ refs: [] }),
  xrefForId: async () => null,
};

// ── Assembled EditorServer ────────────────────────────────────────────────────

export const editorServer = {
  pandoc: pandocServer,
  doi: doiServer,
  crossref: crossrefServer,
  datacite: dataciteServer,
  pubmed: pubmedServer,
  xref: xrefServer,
};
