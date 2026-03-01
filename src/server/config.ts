// src/server/config.ts
import { readFileSync } from 'node:fs';
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

export async function loadConfig(configPath: string): Promise<QuartostoneConfig> {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parse(raw) as Partial<QuartostoneConfig>;
    return { ...DEFAULTS, ...parsed };
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
