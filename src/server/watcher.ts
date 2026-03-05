// src/server/watcher.ts
// Watches pages/ for .qmd changes and runs the save → render → commit pipeline.

import chokidar from 'chokidar';
import { join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { simpleGit } from 'simple-git';
import type { QuartostoneConfig } from './config.js';
import { generateCommitSlug } from './config.js';
import { markXRefCacheDirty } from './api/xref.js';
import { log, warn as logWarn, error as logError } from './utils/logger.js';
import { sanitizeError } from './utils/errorSanitizer.js';

interface WatcherContext {
  cwd: string;
  config: QuartostoneConfig;
  broadcast: (event: string, data?: unknown) => void;
}

export function startWatcher(ctx: WatcherContext) {
  const pagesDir = join(ctx.cwd, ctx.config.pages_dir);
  const git = simpleGit(ctx.cwd);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = chokidar.watch(`${pagesDir}/**/*.qmd`, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100 },
  });

  watcher.on('change', (filePath: string) => {
    markXRefCacheDirty();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      handleChange(filePath).catch(err => {
        try {
          ctx.broadcast('render:error', { path: filePath, error: sanitizeError(err) });
        } catch (broadcastErr) {
          logError(`[watcher] broadcast failed: ${broadcastErr}`);
        }
      });
    }, ctx.config.watch_interval_ms);
  });

  watcher.on('error', (err) => {
    logError(`Watcher error: ${err}`);
  });

  async function handleChange(filePath: string) {
    if (!ctx.config.render_on_save) {
      ctx.broadcast('file:changed', { path: filePath });
      return;
    }

    // Render — compute a POSIX-style path relative to pagesDir (safe on Windows too)
    const relPath = relative(pagesDir, filePath).replace(/\\/g, '/');
    const args = ctx.config.render_scope === 'file'
      ? ['render', filePath]
      : ['render', ctx.cwd];

    const proc = spawn('quarto', args, { cwd: ctx.cwd, shell: false });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.stdout.on('data', () => { /* discard */ });

    proc.on('error', (err) => {
      ctx.broadcast('render:error', { path: relPath, error: err.message });
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        ctx.broadcast('render:error', { path: relPath, error: sanitizeError(stderr) });
        return;
      }

      ctx.broadcast('render:complete', { path: relPath });

      // Commit
      if (ctx.config.commit_mode === 'auto') {
        try {
          const message = generateCommitSlug(ctx.config.commit_message_auto);
          await git.add(filePath);
          await git.commit(message);
          ctx.broadcast('git:committed', { message });
        } catch (e) {
          ctx.broadcast('git:error', { error: sanitizeError(e) });
        }
      } else if (ctx.config.commit_mode === 'prompt') {
        // Broadcast a prompt event — the UI will show a toast
        const autoSlug = generateCommitSlug(ctx.config.commit_message_auto);
        ctx.broadcast('git:prompt', { autoSlug, path: relPath });
      }
      // manual: do nothing
    });
  }

  log(`✓ Watching ${pagesDir} for changes`);
  return watcher;
}
