// src/server/context.ts
// Shared context type passed to all API route registration functions.
import type { QuartostoneConfig } from './config.js';
import type { LinkIndex } from './api/links.js';
import type { SearchIndex } from './api/search.js';
import type { XRefManager } from './api/xref.js';
import type { PreviewManager } from './api/preview.js';
import type { ExportManager } from './api/export.js';

export interface ServerContext {
  cwd: string;
  config: QuartostoneConfig;
  port: number;
  /** Explicit path to the built editor client (dist/client/). */
  clientDist?: string;
  /** Explicit path to the built visual editor bundle (dist/). */
  visualEditorDist?: string;
  /** Auth token for API requests. Undefined in test mode (disables auth). */
  token?: string;
  /** Optional: pre-built LinkIndex (defaults to module singleton if absent). */
  linkIndex?: LinkIndex;
  /** Optional: pre-built SearchIndex (defaults to module singleton if absent). */
  searchIndex?: SearchIndex;
  /** Optional: pre-built XRefManager (defaults to module singleton if absent). */
  xrefManager?: XRefManager;
  /** Optional: pre-built PreviewManager (defaults to module singleton if absent). */
  previewManager?: PreviewManager;
  /** Optional: pre-built ExportManager (defaults to module singleton if absent). */
  exportManager?: ExportManager;
}
