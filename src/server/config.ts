// src/server/config.ts
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

export type CommitMode = 'auto' | 'prompt' | 'manual';
export type RenderScope = 'file' | 'project';

export interface QuartostoneConfig {
  commit_mode: CommitMode;
  commit_message_auto: string;
  render_on_save: boolean;
  render_scope: RenderScope;
  watch_interval_ms: number;
  port: number;
  pages_dir: string;
  open_browser: boolean;
}

const DEFAULTS: QuartostoneConfig = {
  commit_mode: 'prompt',
  commit_message_auto: 'qs-{alphanum8}',
  render_on_save: true,
  render_scope: 'file',
  watch_interval_ms: 300,
  port: 4242,
  pages_dir: 'pages',
  open_browser: true,
};

const VALID_COMMIT_MODES = ['prompt', 'auto', 'manual'] as const;
const VALID_RENDER_SCOPES = ['file', 'project'] as const;

function validateConfig(cfg: QuartostoneConfig): void {
  if (!VALID_COMMIT_MODES.includes(cfg.commit_mode as typeof VALID_COMMIT_MODES[number])) {
    console.warn(`[quartostone] Invalid commit_mode "${cfg.commit_mode}", using "prompt"`);
    cfg.commit_mode = 'prompt';
  }
  if (!VALID_RENDER_SCOPES.includes(cfg.render_scope as typeof VALID_RENDER_SCOPES[number])) {
    console.warn(`[quartostone] Invalid render_scope "${cfg.render_scope}", using "file"`);
    cfg.render_scope = 'file';
  }
  cfg.port = Number(cfg.port);
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    console.warn(`[quartostone] Invalid port "${cfg.port}", using 4242`);
    cfg.port = 4242;
  }
  if (!existsSync(cfg.pages_dir)) {
    console.warn(`[quartostone] pages_dir "${cfg.pages_dir}" does not exist`);
  }
}

export async function loadConfig(configPath: string): Promise<QuartostoneConfig> {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parse(raw) as Partial<QuartostoneConfig>;
    const cfg: QuartostoneConfig = { ...DEFAULTS, ...parsed };
    validateConfig(cfg);
    return cfg;
  } catch {
    console.warn(`Warning: Could not read ${configPath}, using defaults.`);
    return { ...DEFAULTS };
  }
}

export function generateCommitSlug(pattern: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const slug = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return pattern.replace('{alphanum8}', slug);
}
