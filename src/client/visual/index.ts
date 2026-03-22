// src/client/visual/index.ts
// Standalone Quarto Visual Editor Integration for Quartostone.
//
// Method names come directly from packages/editor-types/src/vscode.ts in
// the quarto-visual-editor repo (which mirrors the VS Code extension protocol).

import { pandocServer } from './pandocServer.js';

// ── RPC method name constants (must match editor-types/src/vscode.ts) ─────────

// Editor → Host (editor calls these on the host)
const VSC_VEH_GetHostContext = 'vsc_ve_get_host_context';
const VSC_VEH_ReopenSourceMode = 'vsc_ve_reopen_source_mode';
const VSC_VEH_OnEditorReady = 'vsc_veh_on_editor_ready';
const VSC_VEH_OnEditorUpdated = 'vsc_veh_on_editor_updated';
const VSC_VEH_OnEditorStateChanged = 'vsc_veh_on_editor_state_changed';
const VSC_VEH_FlushEditorUpdates = 'vsc_veh_flush_editor_updates';
const VSC_VEH_SaveDocument = 'vsc_veh_save_document';
const VSC_VEH_RenderDocument = 'vsc_veh_render_document';
const VSC_VEH_EditorResourceUri = 'vsc_veh_editor_resource_url';
const VSC_VEH_OpenURL = 'vsc_veh_open_url';
const VSC_VEH_NavigateToXRef = 'vsc_ve_navigate_to_xref';
const VSC_VEH_NavigateToFile = 'vsc_ve_navigate_to_file';
const VSC_VE_Init = 'vsc_ve_init';
const VSC_VE_GetMarkdownFromState = 'vsc_ve_get_markdown_from_state';
const VSC_VE_PrefsChanged = 'vsc_ve_prefs_changed';

// Services API (editor calls these for prefs, dictionary, math, source)
const kPrefsGetPrefs = "prefs_get_prefs";
const kPrefsSetPrefs = "prefs_set_prefs";
const kDictionaryAvailableDictionaries = "dictionary_available_dictionaries";
const kDictionaryGetDictionary = "dictionary_get_dictionary";
const kDictionaryGetUserDictionary = "dictionary_get_user_dictionary";
const kDictionaryAddToUserDictionary = "dictionary_add_to_user_dictionary";
const kDictionaryGetIgnoredwords = "dictionary_get_ignored_words";
const kDictionaryIgnoreWord = "dictionary_ignore_word";
const kDictionaryUnignoreWord = "dictionary_unignore_word";
const kMathMathjaxTypesetSvg = "math_mathjax_typeset_svg";
const kSourceGetSourcePosLocations = "source_get_source_pos_locations";

// Pandoc RPC (editor calls these for document conversion)
const kPandocGetCapabilities = "pandoc_get_capabilities";
const kPandocListExtensions = "pandoc_list_extensions";
const kPandocMarkdownToAst = "pandoc_markdown_to_ast";
const kPandocAstToMarkdown = "pandoc_ast_to_markdown";

// Host → Editor (host calls these on the editor)
const VSC_VEH_ResolveImageUris = 'vsc_veh_resolve_image_uris';
const VSC_VEH_ResolveBase64Images = 'vsc_veh_resolve_base64_images';
const VSC_VEH_SelectImage = 'vsc_veh_select_image';

// ── Public interface ───────────────────────────────────────────────────────────

export interface VisualEditorOptions {
  container: HTMLElement;
  initialMarkdown: string;
  onDirty?: () => void;
  documentPath?: string | null;
  onOpenPage?: (path: string) => void;
  onSwitchToSource?: () => void;
}

export interface VisualEditorInstance {
  getMarkdown(): Promise<string>;
  setMarkdown(md: string): Promise<void>;
  destroy(): void;
  getCommands(): any[];
  onStateChanged(callback: () => void): () => void;
  updateTheme(): void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export async function createVisualEditor(
  opts: VisualEditorOptions,
): Promise<VisualEditorInstance> {

  // Pending RPC calls FROM HOST TO EDITOR
  let rpcId = 1;
  const pending = new Map<number, { resolve: (v: any) => void, reject: (e: any) => void }>();

  // Last editor state JSON received via onEditorUpdated
  let currentStateJson: unknown = null;
  // Flag: has the editor finished its init()? (prevents premature getMarkdown calls)
  let editorInitialized = false;

  // ── Create the iframe ──────────────────────────────────────────────────────
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
  
  const isDark = document.documentElement.classList.contains('dark') ||
      !document.documentElement.classList.contains('light'); // default to dark
      
  const themeParam = isDark ? '&theme=dark' : '&theme=light';
  iframe.src = `/visual-editor/index.html?v=${Date.now()}${themeParam}`;
  opts.container.appendChild(iframe);

  // ── Inject VS Code-compatible CSS variables into the iframe ────────────────
  // The visual editor's theme.ts reads these from the iframe's <html> element.
  // In VS Code, the webview host sets them. In Quartostone, we inject them.
  const injectVSCodeTheme = () => {
    const idoc = iframe.contentDocument;
    if (!idoc) return;
    const isDark = document.documentElement.classList.contains('dark') ||
      !document.documentElement.classList.contains('light'); // default to dark
    
    // VS Code class needed for darkMode detection in the editor
    idoc.body.className = isDark ? 'vscode-dark bp4-dark' : 'vscode-light';
    const css = isDark ? {
      '--vscode-editor-background': '#1f1f1f',
      '--vscode-editor-foreground': '#ffffff',
      '--vscode-editor-font-size': '13px',
      '--vscode-editor-font-family': 'Consolas, monospace',
      '--vscode-editor-selectionBackground': '#264f78',
      '--vscode-editor-selectionForeground': '',
      '--vscode-editorCursor-foreground': '#aeafad',
      '--vscode-textLink-foreground': '#4ec9b0',
      '--vscode-breadcrumb-foreground': '#a0a0a0',
      '--vscode-titleBar-activeBackground': '#333333',
      '--vscode-titleBar-inactiveBackground': '#333333',
      '--vscode-panel-border': '#333333',
      '--vscode-notebook-cellBorderColor': '#444444',
      '--vscode-notebook-cellEditorBackground': '#252526',
      '--vscode-notebook-focusedCellBorder': '#4f6bed',
      '--vscode-commandCenter-border': '#333333',
      '--vscode-focusBorder': '#007fd4',
      '--vscode-editorWidget-foreground': '#cccccc',
      '--vscode-editorWhitespace-foreground': '#404040',
      '--vscode-editorGhostText-foreground': '#606060',
      '--vscode-editorInfo-foreground': '#3794ff',
      '--vscode-editor-foldBackground': '#264f78',
      '--vscode-editorSuggestWidget-background': '#252526',
      '--vscode-editorSuggestWidget-border': '#454545',
      '--vscode-editorSuggestWidget-foreground': '#d4d4d4',
      '--vscode-editorSuggestWidget-selectedBackground': '#062f4a',
      '--vscode-editorSuggestWidget-selectedForeground': '#d4d4d4',
      '--vscode-editorSuggestWidget-selectedIconForeground': '#d4d4d4',
      '--vscode-editorSuggestWidget-highlightForeground': '#18a3ff',
      '--vscode-editorSuggestWidget-focusHighlightForeground': '#18a3ff',
      '--vscode-disabledForeground': '#6c6c6c',
      '--vscode-charts-orange': '#d18616',
      '--vscode-list-deemphasizedForeground': '#8c8c8c',
      '--vscode-editor-findMatchHighlightBackground': '#333d4f',
      // VS Code Syntax Palette (Dark Mode)
      '--vscode-syntax-keyword': '#569cd6',
      '--vscode-syntax-atom': '#b5cea8',
      '--vscode-syntax-number': '#b5cea8',
      '--vscode-syntax-variable': '#9cdcfe',
      '--vscode-syntax-def': '#dcdcaa',
      '--vscode-syntax-operator': '#d4d4d4',
      '--vscode-syntax-comment': '#6a9955',
      '--vscode-syntax-string': '#ce9178',
      '--vscode-syntax-meta': '#569cd6',
      '--vscode-syntax-builtin': '#569cd6',
      '--vscode-syntax-bracket': '#d4d4d4',
      '--vscode-syntax-tag': '#569cd6',
      '--vscode-syntax-attribute': '#9cdcfe',
      '--vscode-syntax-link': '#4ec9b0',
      '--vscode-syntax-error': '#f44747',
    } : {
      '--vscode-editor-background': '#ffffff',
      '--vscode-editor-foreground': '#000000',
      '--vscode-editor-font-size': '13px',
      '--vscode-editor-font-family': 'Consolas, monospace',
      '--vscode-editor-selectionBackground': '#add6ff',
      '--vscode-editor-selectionForeground': '',
      '--vscode-editorCursor-foreground': '#000000',
      '--vscode-textLink-foreground': '#0066bf',
      '--vscode-breadcrumb-foreground': '#6f6f6f',
      '--vscode-titleBar-activeBackground': '#dddddd',
      '--vscode-titleBar-inactiveBackground': '#eeeeee',
      '--vscode-panel-border': '#c8c8c8',
      '--vscode-notebook-cellBorderColor': '#c8c8c8',
      '--vscode-notebook-cellEditorBackground': '#f3f3f3',
      '--vscode-notebook-focusedCellBorder': '#007acc',
      '--vscode-commandCenter-border': '#d4d4d4',
      '--vscode-focusBorder': '#0066bf',
      '--vscode-editorWidget-foreground': '#6f6f6f',
      '--vscode-editorWhitespace-foreground': '#d4d4d4',
      '--vscode-editorGhostText-foreground': '#a0a0a0',
      '--vscode-editorInfo-foreground': '#1a85ff',
      '--vscode-editor-foldBackground': '#e8f2fc',
      '--vscode-editorSuggestWidget-background': '#f3f3f3',
      '--vscode-editorSuggestWidget-border': '#c8c8c8',
      '--vscode-editorSuggestWidget-foreground': '#000000',
      '--vscode-editorSuggestWidget-selectedBackground': '#0060c0',
      '--vscode-editorSuggestWidget-selectedForeground': '#ffffff',
      '--vscode-editorSuggestWidget-selectedIconForeground': '#ffffff',
      '--vscode-editorSuggestWidget-highlightForeground': '#0066bf',
      '--vscode-editorSuggestWidget-focusHighlightForeground': '#0066bf',
      '--vscode-disabledForeground': '#a0a0a0',
      '--vscode-charts-orange': '#bc8501',
      '--vscode-list-deemphasizedForeground': '#6c6c6c',
      '--vscode-editor-findMatchHighlightBackground': '#ea5c0033',
      // VS Code Syntax Palette (Light Mode)
      '--vscode-syntax-keyword': '#0000ff',
      '--vscode-syntax-atom': '#0000cd',
      '--vscode-syntax-number': '#098658',
      '--vscode-syntax-variable': '#001080',
      '--vscode-syntax-def': '#795e26',
      '--vscode-syntax-operator': '#000000',
      '--vscode-syntax-comment': '#008000',
      '--vscode-syntax-string': '#a31515',
      '--vscode-syntax-meta': '#267f99',
      '--vscode-syntax-builtin': '#795e26',
      '--vscode-syntax-bracket': '#000000',
      '--vscode-syntax-tag': '#800000',
      '--vscode-syntax-attribute': '#ff0000',
      '--vscode-syntax-link': '#0000ff',
      '--vscode-syntax-error': '#f44747',
    };
    const htmlEl = idoc.documentElement;
    Object.entries(css).forEach(([k, v]) => htmlEl.style.setProperty(k, v));

    // Force nuclear styles (0px radius, dark portals)
    let nuclearStyle = idoc.getElementById('quarto-nuclear-styles');
    if (!nuclearStyle) {
      nuclearStyle = idoc.createElement('style');
      nuclearStyle.id = 'quarto-nuclear-styles';
      idoc.head.appendChild(nuclearStyle);
    }
    nuclearStyle.textContent = '';
  };

  iframe.addEventListener('load', () => { injectVSCodeTheme(); });


  // ── Helpers ────────────────────────────────────────────────────────────────

  function postToEditor(msg: object) {
    iframe.contentWindow?.postMessage(msg, '*');
  }

  // Send an RPC call to the editor (host → editor direction)
  function callEditor(method: string, args: unknown[] = []): Promise<any> {
    const id = rpcId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`[VisualEditor] RPC timeout: ${method}`));
        }
      }, 5000);

      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      postToEditor({ jsonrpc: '2.0', id, method, params: args });
    });
  }

  // Reply to an incoming RPC request from the editor
  function respond(id: number, result: unknown) {
    postToEditor({ jsonrpc: '2.0', id, result });
  }
  function respondError(id: number, message: string) {
    postToEditor({ jsonrpc: '2.0', id, error: { message } });
  }

  // ── Message dispatcher ─────────────────────────────────────────────────────
  const handleMessage = async (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    const msg = event.data as any;
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;

    // Response to a host→editor call we made
    if (msg.id != null && !msg.method) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(msg.error);
        else p.resolve(msg.result);
      }
      return;
    }

    // Incoming RPC call from the editor → host
    const { id, method, params } = msg as { id: number, method: string, params: unknown[] };
    const args = Array.isArray(params) ? params : [];

    try {
      switch (method) {

        // ── Called first — editor asks for host context before rendering ──────
        case VSC_VEH_GetHostContext:
          const isHostDark = !document.documentElement.classList.contains('light');
          respond(id, {
            documentPath: opts.documentPath || '',
            resourceDir: '/',
            projectDir: '/',
            isWindowsDesktop: navigator.platform.toLowerCase().includes('win'),
            executableLanguages: [],
            darkMode: isHostDark,
          });
          break;

        // ── Called when fully mounted — send the initial markdown ─────────────
        case VSC_VEH_OnEditorReady:
          respond(id, null);
          // Give the editor its content
          try {
            await callEditor(VSC_VE_Init, [opts.initialMarkdown, null]);
            editorInitialized = true;
          } catch (initErr) {
            console.error('[VisualEditor] init() failed:', initErr);
          }
          break;

        // ── Content changed ──────────────────────────────────────────────────
        case VSC_VEH_OnEditorUpdated:
          currentStateJson = args[0] ?? null;
          opts.onDirty?.();
          respond(id, null);
          break;

        case VSC_VEH_OnEditorStateChanged:
          respond(id, null);
          break;

        case VSC_VEH_FlushEditorUpdates:
          respond(id, null);
          break;

        // ── File operations ──────────────────────────────────────────────────
        case VSC_VEH_SaveDocument:
          opts.onDirty?.();   // Light up the Save button
          respond(id, null);
          break;

        // ── Pandoc ───────────────────────────────────────────────────────────
        case kPandocListExtensions:
          try {
            const ext = await (pandocServer as any).listExtensions(args[0]);
            respond(id, ext);
          } catch (err) {
            respondError(id, String(err));
          }
          break;

        case kPandocGetCapabilities:
          try {
            const cap = await (pandocServer as any).getCapabilities();
            respond(id, cap);
          } catch (err) {
            respondError(id, String(err));
          }
          break;

        case kPandocMarkdownToAst:
          try {
            const ast = await (pandocServer as any).markdownToAst(args[0], args[1], args[2] || []);
            respond(id, ast);
          } catch (err) {
            respondError(id, String(err));
          }
          break;

        case kPandocAstToMarkdown:
          try {
            const md = await (pandocServer as any).astToMarkdown(args[0], args[1], args[2] || []);
            respond(id, md);
          } catch (err) {
            respondError(id, String(err));
          }
          break;

        // ── Services API ─────────────────────────────────────────────────────
        case kPrefsGetPrefs:
          respond(id, {
            showOutline: false,
            darkMode: document.documentElement.classList.contains('dark'),
            fontSize: 14,
            fontFamily: "var(--bs-body-font-family)",
            maxContentWidth: 1000,
            realtimeSpelling: false,
            dictionaryLocale: 'en_US',
            emojiSkinTone: 0,
            listSpacing: 'spaced',
            tabKeyMoveFocus: false,
            equationPreview: true,
            markdownWrap: 'none',
            markdownWrapColumn: 72,
            markdownReferences: 'block',
            markdownReferencesPrefix: '',
            markdownReferenceLinks: false,
            zoteroUseBetterBibtex: false,
            bibliographyDefaultType: 'bib',
            citationDefaultInText: false,
            packageListingEnabled: false,
            spacesForTab: true,
            tabWidth: 2,
            autoClosingBrackets: true,
            highlightSelectedWord: true,
            lineNumbers: true,
            showWhitespace: false,
            blinkingCursor: true,
            quickSuggestions: true
          });
          break;

        case kPrefsSetPrefs:
          respond(id, null);
          break;

        case kDictionaryAvailableDictionaries:
          respond(id, []);
          break;

        case kDictionaryGetDictionary:
          respond(id, { aff: "", words: "" });
          break;

        case kDictionaryGetUserDictionary:
        case kDictionaryGetIgnoredwords:
          respond(id, []);
          break;

        case kDictionaryAddToUserDictionary:
        case kDictionaryIgnoreWord:
        case kDictionaryUnignoreWord:
          respond(id, []); // should return updated word list, but empty is safe enough 
          break;

        case kMathMathjaxTypesetSvg:
          // Just stub it
          respond(id, null);
          break;

        case kSourceGetSourcePosLocations:
          respond(id, []);
          break;

        case VSC_VEH_RenderDocument:
          respond(id, null);
          break;

        case VSC_VEH_ReopenSourceMode:
          opts.onSwitchToSource?.();
          respond(id, null);
          break;

        // ── Resource resolution ───────────────────────────────────────────────
        case VSC_VEH_EditorResourceUri:
          respond(id, args[0]);   // pass through unchanged
          break;

        case VSC_VEH_ResolveImageUris:
          respond(id, args[0]);   // pass through unchanged
          break;

        case VSC_VEH_ResolveBase64Images:
          respond(id, args[0]);
          break;

        // ── Navigation ────────────────────────────────────────────────────────
        case VSC_VEH_OpenURL:
          if (typeof args[0] === 'string') window.open(args[0] as string, '_blank');
          respond(id, null);
          break;

        case VSC_VEH_NavigateToFile:
          if (typeof args[0] === 'string') opts.onOpenPage?.(args[0] as string);
          respond(id, null);
          break;

        case VSC_VEH_NavigateToXRef:
          respond(id, null);
          break;

        case VSC_VEH_SelectImage:
          respond(id, null);
          break;

        default:
          // Unknown method — respond with success to avoid editor hanging
          respond(id, null);
          break;
      }
    } catch (e) {
      respondError(id, String(e));
    }
  };

  window.addEventListener('message', handleMessage);

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    async getMarkdown(): Promise<string> {
      if (!editorInitialized || !currentStateJson) {
        return opts.initialMarkdown;
      }
      try {
        const md = await callEditor(VSC_VE_GetMarkdownFromState, [currentStateJson]);
        return typeof md === 'string' ? md : opts.initialMarkdown;
      } catch {
        return opts.initialMarkdown;
      }
    },

    async setMarkdown(md: string): Promise<void> {
      opts.initialMarkdown = md;
      currentStateJson = null;
      editorInitialized = false;
      try {
        await callEditor(VSC_VE_Init, [md, null]);
        editorInitialized = true;
      } catch (e) {
        console.error('[VisualEditor] setMarkdown failed:', e);
      }
    },

    destroy(): void {
      window.removeEventListener('message', handleMessage);
      pending.clear();
      iframe.remove();
    },

    getCommands(): any[] { return []; },
    onStateChanged(_cb: () => void): () => void { return () => { }; },
    updateTheme() {
      injectVSCodeTheme();
      // Notify the editor to re-read theme state from DOM and re-render React/Fluent UI components
      callEditor(VSC_VE_PrefsChanged, [{}]);
    },
  };
}
