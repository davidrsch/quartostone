// src/client/visual/index.ts
// Standalone Quarto Visual Editor Integration for Quartostone.
// This module replaces the legacy Panmirror UMD loader with an iframe-based 
// approach that loads the 'quarto-visual-editor' bundle and communicates 
// via window.postMessage (JSON-RPC).

export interface VisualEditorOptions {
  container: HTMLElement;
  initialMarkdown: string;
  /** Called whenever the document is modified */
  onDirty?: () => void;
  /** Path of the document being edited (for resource resolution) */
  documentPath?: string | null;
  /** Called when the user clicks a file link or xref link in visual mode */
  onOpenPage?: (path: string) => void;
}

export interface VisualEditorInstance {
  /** Get the current document as markdown */
  getMarkdown(): Promise<string>;
  /** Replace the entire editor content */
  setMarkdown(md: string): Promise<void>;
  /** Destroy the editor and free resources */
  destroy(): void;
  /** Get the available commands - Stubbed for now as the new editor has its own UI */
  getCommands(): any[];
  /** Subscribe to state changes - Stubbed for now */
  onStateChanged(callback: () => void): () => void;
}

/**
 * Creates the Visual Editor. 
 * Instead of mounting a JS library directly, we mount an IFRAME that points to our standalone app.
 */
export async function createVisualEditor(
  opts: VisualEditorOptions,
): Promise<VisualEditorInstance> {
  const iframe = document.createElement('iframe');

  // Configure iframe to be seamless and occupy full space
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  iframe.src = '/visual-editor/index.html'; // Assuming we serve the dist here

  opts.container.appendChild(iframe);

  // Communication Bridge
  let rpcRequestId = 1;
  const pendingRequests = new Map<number, { resolve: (val: any) => void, reject: (err: any) => void }>();

  const handleMessage = (event: MessageEvent) => {
    // Only trust messages from our iframe
    if (event.source !== iframe.contentWindow) return;

    const data = event.data;
    if (data && typeof data === 'object') {
      // Handle RPC Responses
      if (data.id && (data.result !== undefined || data.error !== undefined)) {
        const pending = pendingRequests.get(data.id);
        if (pending) {
          pendingRequests.delete(data.id);
          if (data.error) pending.reject(data.error);
          else pending.resolve(data.result);
        }
      }

      // Handle RPC Notifications / Events from Editor
      if (data.method === 'onDirty') {
        opts.onDirty?.();
      }
      if (data.method === 'onOpenPage' && data.params?.path) {
        opts.onOpenPage?.(data.params.path);
      }
    }
  };

  window.addEventListener('message', handleMessage);

  const callRpc = (method: string, params: any = {}): Promise<any> => {
    const id = rpcRequestId++;
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      iframe.contentWindow?.postMessage({
        jsonrpc: '2.0',
        id,
        method,
        params
      }, '*');
    });
  };

  // Wait for editor to signal it is ready
  await new Promise<void>((resolve) => {
    const readyListener = (event: MessageEvent) => {
      if (event.source === iframe.contentWindow && event.data?.method === 'ready') {
        window.removeEventListener('message', readyListener);
        resolve();
      }
    };
    window.addEventListener('message', readyListener);
  });

  // Initialize with markdown
  await callRpc('setMarkdown', {
    markdown: opts.initialMarkdown,
    path: opts.documentPath,
    // Provide some context for the editor
    config: {
      pandocMode: 'markdown',
      quarto: true
    }
  });

  return {
    async getMarkdown(): Promise<string> {
      const result = await callRpc('getMarkdown');
      return result?.markdown ?? '';
    },

    async setMarkdown(md: string): Promise<void> {
      await callRpc('setMarkdown', { markdown: md, path: opts.documentPath });
    },

    destroy(): void {
      window.removeEventListener('message', handleMessage);
      iframe.remove();
    },

    getCommands(): any[] {
      return []; // The new editor provides its own toolbar
    },

    onStateChanged(cb: () => void): () => void {
      // In the new system, 'Update' / 'onDirty' are handled via RPC notifications
      return () => { };
    }
  };
}
