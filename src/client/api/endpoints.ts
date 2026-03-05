/**
 * Canonical API endpoint paths for the quartostone server.
 * Use these constants instead of raw strings to prevent typos and ease refactoring.
 */
export const API = {
  // Pages
  pages: '/api/pages',
  directories: '/api/directories',

  // Git
  gitStatus: '/api/git/status',
  gitLog: '/api/git/log',
  gitBranches: '/api/git/branches',
  gitCheckout: '/api/git/checkout',
  gitCommit: '/api/git/commit',
  gitPush: '/api/git/push',
  gitPull: '/api/git/pull',
  gitRemote: '/api/git/remote',
  gitDiff: '/api/git/diff',
  gitShow: '/api/git/show',
  gitRestore: '/api/git/restore',
  gitConflicts: '/api/git/conflicts',
  gitMerge: '/api/git/merge',
  gitMergeAbort: '/api/git/merge-abort',
  gitMergeComplete: '/api/git/merge-complete',

  // Links
  linksGraph: '/api/links/graph',
  linksBacklinks: '/api/links/backlinks',
  linksForward: '/api/links/forward',
  linksSearch: '/api/links/search',

  // Search
  search: '/api/search',
  searchReindex: '/api/search/reindex',

  // XRef
  xrefIndex: '/api/xref/index',
  xrefForId: '/api/xref/forId',

  // Preview
  previewStart: '/api/preview/start',
  previewStop: '/api/preview/stop',
  previewStatus: '/api/preview/status',
  previewReady: '/api/preview/ready',
  previewLogs: '/api/preview/logs',

  // Export
  exportStart: '/api/export',
  exportStatus: '/api/export/status',
  exportDownload: '/api/export/download',

  // Render
  render: '/api/render',

  // Pandoc
  pandocMarkdownToAst: '/api/pandoc/markdownToAst',
  pandocAstToMarkdown: '/api/pandoc/astToMarkdown',
  pandocCapabilities: '/api/pandoc/capabilities',
  pandocListExtensions: '/api/pandoc/listExtensions',
  pandocGetBibliography: '/api/pandoc/getBibliography',
  pandocAddToBibliography: '/api/pandoc/addToBibliography',
  pandocCitationHtml: '/api/pandoc/citationHTML',

  // Exec
  exec: '/api/exec',

  // Trash
  trash: '/api/trash',
  trashRestore: '/api/trash/restore',

  // Assets
  assets: '/api/assets',

  // DB
  db: '/api/db',
  dbCreate: '/api/db/create',

  // Server config (Q29)
  config: '/api/config',

  // Pages rename (base path — append /<path> for PATCH /api/pages/<path>)
  pagesRename: '/api/pages',
  // Directories delete (base path — append /<path> for DELETE /api/directories/<path>)
  directoriesDelete: '/api/directories',
} as const;

export type ApiEndpoint = typeof API[keyof typeof API];
