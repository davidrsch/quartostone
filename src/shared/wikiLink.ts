// src/shared/wikiLink.ts
// Canonical wiki-link regular expressions shared between server (link scanner)
// and client (editor decoration plugin).

/** Scan pattern: finds all [[link]] occurrences in a string, capturing inner text. */
export const WIKI_LINK_SCAN_RE = /\[\[([^\]]+?)\]\]/g;

/** Inline pattern for editor decorations — matches the whole [[...]] token. */
export const WIKI_LINK_INLINE_RE = /\[\[[^\]]+\]\]/g;
