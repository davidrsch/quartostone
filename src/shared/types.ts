// Shared request/response types used by both server and client

// ── Page tree ─────────────────────────────────────────────────────────────────

export interface PageNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  icon?: string;
  children?: PageNode[];
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  path:    string;
  title:   string;
  excerpt: string;
  score:   number;
}

// ── Database ──────────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'select' | 'date' | 'checkbox' | 'number';

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  options?: string[];  // for select type
}

export interface DbPage {
  schema: FieldDef[];
  rows: Record<string, string>[];
}

// ── Git ───────────────────────────────────────────────────────────────────────

export interface CommitEntry {
  hash: string;
  message: string;
  author_name: string;
  date: string;
}

export interface StatusFile {
  path: string;
  index: string;
  working_dir: string;
}

export interface GitStatus {
  files: StatusFile[];
  current: string;
  isClean?: boolean;
}

export interface Branch {
  name: string;
  current: boolean;
  sha: string;
  date: string;
}

export interface RemoteInfo {
  url: string;
  branch: string;
  tracking: string;
  ahead: number;
  behind: number;
}

// ── Export ────────────────────────────────────────────────────────────────────

export type ExportJobStatus = 'pending' | 'running' | 'done' | 'error';
