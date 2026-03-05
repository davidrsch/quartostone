// src/client/storage.ts
// Centralised localStorage / sessionStorage key constants.
// All code should use these instead of raw string literals.
export const STORAGE_KEYS = {
  favorites:    'qs_favorites',
  recent:       'qs_recent',
  theme:        'qs_theme',
  sidebarWidth: 'qs_sidebar_width',
  graphNode:    (id: string) => `qs_graph_${id}`,
} as const;
