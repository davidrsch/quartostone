// src/client/visual/editorUI.ts
// Client-side implementation of EditorUI for the panmirror visual editor.
// Dialogs use native browser confirm/alert. Prefs use defaults. Images left empty
// (panmirror has built-in inline SVG fallbacks for missing URLs).

import type { editorServer } from './pandocServer.js';

// ── Type aliases (avoid importing from the editor package directly) ──────────

type SkinTone = number;

// ── Prefs ─────────────────────────────────────────────────────────────────────

export function buildEditorUIPrefs() {
  const darkMode = (document.documentElement.classList.contains('dark') ||
    (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false));
  let emojiTone: SkinTone = 0;
  let bibDefaultType = 'bib';
  let citationDefaultInText = false;

  return {
    realtimeSpelling: () => false,
    darkMode: () => darkMode,
    listSpacing: () => 'spaced' as const,
    equationPreview: () => true,
    packageListingEnabled: () => false,
    tabKeyMoveFocus: () => false,
    emojiSkinTone: () => emojiTone,
    setEmojiSkinTone: (t: SkinTone) => { emojiTone = t; },
    zoteroUseBetterBibtex: () => false,
    bibliographyDefaultType: () => bibDefaultType,
    setBibliographyDefaultType: (t: string) => { bibDefaultType = t; },
    citationDefaultInText: () => citationDefaultInText,
    setCitationDefaultInText: (v: boolean) => { citationDefaultInText = v; },
    spacesForTab: () => true,
    tabWidth: () => 2,
    autoClosingBrackets: () => true,
    highlightSelectedWord: () => true,
    lineNumbers: () => false,
    showWhitespace: () => false,
    blinkingCursor: () => true,
    quickSuggestions: () => false,
  };
}

// ── Display ───────────────────────────────────────────────────────────────────

export function buildEditorDisplay(onOpenPage?: (path: string) => void) {
  return {
    openURL: (url: string) => window.open(url, '_blank', 'noopener'),

    /**
     * Navigate to the file that contains a cross-reference.
     * `xref` is the panmirror XRef object: { file?: string, id?: string, ... }
     * We open the file that contains the xref; `file` is relative to the project.
     */
    navigateToXRef: (file: string, xref: Record<string, unknown>) => {
      const target = (typeof xref['file'] === 'string' && xref['file'])
        ? xref['file']
        : file;
      if (target && onOpenPage) onOpenPage(target);
    },

    /**
     * Navigate to another file referenced from the visual editor
     * (e.g. a wiki-link or an explicit file path in a link).
     */
    navigateToFile: (file: string) => {
      if (file && onOpenPage) onOpenPage(file);
    },

    showContextMenu: undefined,
  };
}

// ── Context ───────────────────────────────────────────────────────────────────

export function buildEditorUIContext(documentPath: string | null) {
  return {
    // EditorUIImageResolver
    resolveImageUris: async (uris: string[]) => uris,
    resolveBase64Images: undefined,
    selectImage: undefined,

    // EditorUIContext
    isWindowsDesktop: () => false,
    isActiveTab: () => true,
    getDocumentPath: () => documentPath,
    withSavedDocument: async () => true,
    getDefaultResourceDir: () => '',
    mapResourceToURL: (path: string) => path,
    watchResource: (_path: string, _notify: () => void) => () => { /* noop */ },
    translateText: (text: string) => text,
    droppedUris: () => null,
    clipboardUris: async () => null,
    clipboardImage: async () => null,
  };
}

// ── Dialogs ───────────────────────────────────────────────────────────────────

export function buildEditorDialogs() {
  return {
    // Simple alert
    alert: async (title: string, message: string, _type: number) => {
      window.alert(`${title}\n\n${message}`);
      return true;
    },

    // Yes/No confirmation
    yesNoMessage: async (
      title: string,
      message: string,
      _type: number,
      yesLabel: string,
      _noLabel: string,
    ) => {
      return window.confirm(`${title}\n\n${message}\n\n${yesLabel}?`);
    },

    // All other dialogs return null (user cancels / not implemented)
    editLink: async () => null,
    editImage: async () => null,
    editCodeBlock: async () => null,
    editList: async () => null,
    editAttr: async () => null,
    editSpan: async () => null,
    editDiv: async () => null,
    editCallout: async () => null,
    editRawInline: async () => null,
    editRawBlock: async () => null,
    editMath: async () => null,
    insertTable: async () => null,
    insertTabset: async () => null,
    insertCite: async () => null,

    // Generic HTML dialog — always cancel
    htmlDialog: async (
      _title: string,
      _okText: string | null,
      _create: unknown,
      _focus: () => void,
      _validate: () => string | null,
    ) => false,
  };
}

// ── Images (empty strings — editor uses inline SVG fallbacks) ─────────────────

export function buildEditorUIImages() {
  const empty = '';
  const emptyObj = (keys: string[]) =>
    Object.fromEntries(keys.map(k => [k, empty]));

  return {
    copy: empty,
    properties: empty,
    properties_deco: empty,
    properties_deco_dark: empty,
    removelink: empty,
    runchunk: empty,
    runprevchunks: empty,
    search: empty,
    search_progress: empty,
    omni_insert: emptyObj([
      'generic','heading1','heading1_dark','heading2','heading2_dark',
      'heading3','heading3_dark','heading4','heading4_dark',
      'ordered_list','ordered_list_dark','bullet_list','bullet_list_dark',
      'blockquote','blockquote_dark','math_inline','math_inline_dark',
      'math_display','math_display_dark','html_block','html_block_dark',
      'line_block','line_block_dark','emoji','emoji_dark','comment','comment_dark',
      'div','div_dark','code_block','code_block_dark','footnote','footnote_dark',
      'citation','citation_dark','cross_reference','cross_reference_dark',
      'symbol','symbol_dark','table','table_dark','definition_list','definition_list_dark',
      'horizontal_rule','horizontal_rule_dark','image','image_dark','link','link_dark',
      'paragraph','paragraph_dark','raw_block','raw_block_dark','raw_inline','raw_inline_dark',
      'tex_block','tex_block_dark','yaml_block','yaml_block_dark',
      'python_chunk','sql_chunk','d3_chunk','stan_chunk',
      'bash_chunk','bash_chunk_dark','r_chunk','r_chunk_dark',
      'rcpp_chunk','rcpp_chunk_dark','tabset','tabset_dark',
      'slide_columns','slide_columns_dark','slide_pause','slide_pause_dark',
      'slide_notes','slide_notes_dark',
    ]),
    citations: emptyObj([
      'article','article_dark','book','book_dark','broadcast','broadcast_dark',
      'data','data_dark','entry','entry_dark','image','image_dark',
      'legal','legal_dark','map','map_dark','movie','movie_dark','other','other_dark',
      'web','web_dark','thesis','thesis_dark','software','software_dark',
    ]),
    lists: emptyObj(['checked', 'checked_dark', 'unchecked', 'unchecked_dark']),
  };
}

// ── Assembled EditorUI ────────────────────────────────────────────────────────

export function buildEditorUI(
  documentPath: string | null,
  onOpenPage?: (path: string) => void,
) {
  return {
    dialogs:  buildEditorDialogs(),
    display:  buildEditorDisplay(onOpenPage),
    context:  buildEditorUIContext(documentPath),
    prefs:    buildEditorUIPrefs(),
    images:   buildEditorUIImages(),
  };
}
