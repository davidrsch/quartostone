// src/server/api/git.ts
// GET  /api/git/log?path=   — commit history (all or per-file)
// POST /api/git/commit      — commit staged + all .qmd changes
// GET  /api/git/diff?sha=   — diff for a specific commit
// GET  /api/git/status      — working tree status + ahead/behind counts
// GET  /api/git/remote      — remote URL + ahead/behind
// POST /api/git/push        — push to remote
// POST /api/git/pull        — pull from remote (fast-forward only)
// PATCH /api/git/remote     — set remote URL

import type { Express, Request, Response } from 'express';
import { simpleGit } from 'simple-git';
import type { ServerContext } from '../index.js';

export function registerGitApi(app: Express, ctx: ServerContext) {
  const git = simpleGit(ctx.cwd);

  app.get('/api/git/log', async (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string | undefined;
      const log = filePath
        ? await git.log({ maxCount: 50, file: filePath })
        : await git.log({ maxCount: 50 });
      res.json(log.all);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/git/commit', async (req: Request, res: Response) => {
    try {
      const { message } = req.body as { message?: string };
      if (!message) return res.status(400).json({ error: 'message required' });
      await git.add(`${ctx.config.pages_dir}/`);
      const result = await git.commit(message);
      res.json({ ok: true, commit: result.commit });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/git/diff', async (req: Request, res: Response) => {
    try {
      const sha = req.query.sha as string;
      if (!sha) return res.status(400).json({ error: 'sha required' });
      const diff = await git.show([sha]);
      res.json({ diff });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/git/status', async (_req: Request, res: Response) => {
    try {
      const status = await git.status();
      res.json(status);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ── Remote push/pull ────────────────────────────────────────────────────────

  app.get('/api/git/remote', async (_req: Request, res: Response) => {
    try {
      // Get remote URL
      let url = '';
      try {
        url = (await git.remote(['get-url', 'origin']) ?? '').trim();
      } catch { /* no remote */ }

      // Fetch to update tracking info (non-failing)
      try {
        await git.fetch(['--no-tags', '--prune', 'origin']);
      } catch { /* no network / no remote */ }

      const status = await git.status();
      res.json({
        url,
        branch: status.current ?? '',
        tracking: status.tracking ?? '',
        ahead: status.ahead,
        behind: status.behind,
      });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/git/push', async (_req: Request, res: Response) => {
    try {
      const pushResult = await git.push('origin');
      res.json({ ok: true, pushed: pushResult.pushed });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/git/pull', async (_req: Request, res: Response) => {
    try {
      // Fast-forward only — if not FF-able, return error with message
      const pullResult = await git.pull('origin', undefined, ['--ff-only']);
      res.json({
        ok: true,
        summary: { changes: pullResult.summary.changes, insertions: pullResult.summary.insertions, deletions: pullResult.summary.deletions },
      });
    } catch (e) {
      const msg = String(e);
      const conflict = msg.includes('CONFLICT') || msg.includes('not possible to fast-forward');
      res.status(conflict ? 409 : 500).json({
        error: conflict
          ? 'Cannot fast-forward. Remote has diverged. Pull manually or rebase.'
          : msg,
        conflict,
      });
    }
  });

  app.patch('/api/git/remote', async (req: Request, res: Response) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url) return res.status(400).json({ error: 'url required' });
      // Set or add remote
      try {
        await git.remote(['set-url', 'origin', url]);
      } catch {
        await git.addRemote('origin', url);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
}
