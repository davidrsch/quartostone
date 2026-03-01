// src/server/watcher.ts
// Watches pages/ for .qmd changes and runs the save → render → commit pipeline.

import chokidar from 'chokidar';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { simpleGit } from 'simple-git';
import type { QuartostoneConfig } from './config.js';
import { generateCommitSlug } from './config.js';

interface WatcherContext {
  cwd: string;
  config: QuartostoneConfig;
  broadcast: (event: string, data?: unknown) => void;
}

export function startWatcher(ctx: WatcherContext) {
  const pagesDir = join(ctx.cwd, 'pages');
  const git = simpleGit(ctx.cwd);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = chokidar.watch(`${pagesDir}/**/*.qmd`, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100 },
  });

  watcher.on('change', (filePath: string) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => handleChange(filePath), ctx.config.watch_interval_ms);
  });

  async function handleChange(filePath: string) {
    if (!ctx.config.render_on_save) {
      ctx.broadcast('file:changed', { path: filePath });
      return;
    }

    // Render
    const relPath = filePath.replace(pagesDir + '/', '');
    const cmd =
      ctx.config.render_scope === 'file'
        ? `quarto render "${filePath}"`
        : `quarto render "${ctx.cwd}"`;

    exec(cmd, { cwd: ctx.cwd }, async (error, _stdout, stderr) => {
      if (error) {
        ctx.broadcast('render:error', { path: relPath, error: stderr });
        return;
      }

      ctx.broadcast('render:complete', { path: relPath });

      // Commit
      if (ctx.config.commit_mode === 'auto') {
        try {
          const message = generateCommitSlug(ctx.config.commit_message_auto);
          await git.add('pages/');
          await git.commit(message);
          ctx.broadcast('git:committed', { message });
        } catch (e) {
          ctx.broadcast('git:error', { error: String(e) });
        }
      } else if (ctx.config.commit_mode === 'prompt') {
        // Broadcast a prompt event — the UI will show a toast
        const autoSlug = generateCommitSlug(ctx.config.commit_message_auto);
        ctx.broadcast('git:prompt', { autoSlug, path: relPath });
      }
      // manual: do nothing
    });
  }

  console.log(`✓ Watching ${pagesDir} for changes`);
  return watcher;
}
