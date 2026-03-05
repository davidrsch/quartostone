// src/server/config.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse } from 'yaml';
import { warn as logWarn } from './utils/logger.js';

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
  /** When false (default) the POST /api/exec endpoint returns 403. Set true to allow code execution. */
  allow_code_execution: boolean;
  /** Override the subprocess execution timeout in ms. Defaults to 30 000. Primarily for tests. */
  exec_timeout_ms?: number;
}

export const DEFAULTS: QuartostoneConfig = {
  commit_mode: 'prompt',
  commit_message_auto: 'qs-{alphanum8}',
  render_on_save: true,
  render_scope: 'file',
  watch_interval_ms: 300,
  port: 4242,
  pages_dir: 'pages',
  open_browser: true,
  allow_code_execution: false,
};

const VALID_COMMIT_MODES = ['prompt', 'auto', 'manual'] as const;
const VALID_RENDER_SCOPES = ['file', 'project'] as const;

function validateConfig(cfg: QuartostoneConfig): { warnings: string[] } {
  const warnings: string[] = [];
  if (!VALID_COMMIT_MODES.includes(cfg.commit_mode as typeof VALID_COMMIT_MODES[number])) {
    warnings.push(`Invalid commit_mode "${cfg.commit_mode}", using "prompt"`);
    cfg.commit_mode = 'prompt';
  }
  if (!VALID_RENDER_SCOPES.includes(cfg.render_scope as typeof VALID_RENDER_SCOPES[number])) {
    warnings.push(`Invalid render_scope "${cfg.render_scope}", using "file"`);
    cfg.render_scope = 'file';
  }
  cfg.port = Number(cfg.port);
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    warnings.push(`Invalid port "${cfg.port}", using 4242`);
    cfg.port = 4242;
  }
  const cwd = process.cwd();
  const resolvedPagesDir = resolve(cwd, cfg.pages_dir);
  const resolvedRoot = resolve(cwd);
  if (!resolvedPagesDir.startsWith(resolvedRoot + sep) && resolvedPagesDir !== resolvedRoot) {
    warnings.push('pages_dir resolves outside project root, resetting to "pages"');
    cfg.pages_dir = 'pages';
  }
  if (!Number.isFinite(cfg.watch_interval_ms) || cfg.watch_interval_ms <= 0) {
    cfg.watch_interval_ms = 300;
  }
  if (!existsSync(cfg.pages_dir)) {
    warnings.push(`pages_dir "${cfg.pages_dir}" does not exist`);
  }
  return { warnings };
}

export async function loadConfig(configPath: string): Promise<QuartostoneConfig> {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parse(raw) as Partial<QuartostoneConfig>;
    const cfg: QuartostoneConfig = { ...DEFAULTS, ...parsed };
    const { warnings } = validateConfig(cfg);
    for (const w of warnings) logWarn(w);
    return cfg;
  } catch {
    logWarn(`Could not read ${configPath}, using defaults.`);
    return { ...DEFAULTS };
  }
}

export function generateCommitSlug(pattern: string): string {
  const slug = randomBytes(4).toString('hex'); // 4 bytes = 8 lowercase hex chars [0-9a-f]
  return pattern.replace('{alphanum8}', slug);
}
