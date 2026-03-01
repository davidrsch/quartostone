// src/server/api/git.ts
// GET  /api/git/log?path=   — commit history (all or per-file)
// POST /api/git/commit      — commit staged + all .qmd changes
// GET  /api/git/diff?sha=   — diff for a specific commit

import type { Express, Request, Response } from 'express';
import { simpleGit } from 'simple-git';
import type { ServerContext } from '../index.js';

export function registerGitApi(app: Express, ctx: ServerContext) {
  const git = simpleGit(ctx.cwd);

  app.get('/api/git/log', async (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string | undefined;
      const options = filePath ? ['--follow', '--', filePath] : [];
      const log = await git.log({ maxCount: 50, '--': undefined, ...(!filePath ? {} : {}) });
      void options;
      res.json(log.all);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/git/commit', async (req: Request, res: Response) => {
    try {
      const { message } = req.body as { message?: string };
      if (!message) return res.status(400).json({ error: 'message required' });
      await git.add('pages/');
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
}
