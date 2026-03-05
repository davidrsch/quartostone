// src/server/api/git.ts
// GET  /api/git/log?path=         — commit history (all or per-file)
// POST /api/git/commit            — commit staged + all .qmd changes
// GET  /api/git/diff?sha=         — diff for a specific commit
// GET  /api/git/status            — working tree status + ahead/behind counts
// GET  /api/git/remote            — remote URL + ahead/behind
// POST /api/git/push              — push to remote
// POST /api/git/pull              — pull from remote (fast-forward only)
// PATCH /api/git/remote           — set remote URL
// ── Phase 5: Branch management ──────────────────────────────────────────────
// GET  /api/git/branches          — list all local branches + current
// POST /api/git/branches          — create a new branch
// POST /api/git/checkout          — switch to a branch (auto-stash if dirty)
// POST /api/git/merge             — merge a branch into current (no-FF commit)
// POST /api/git/merge-abort       — abort an in-progress merge (#100)
// GET  /api/git/conflicts         — list conflicted files (#100)
// POST /api/git/merge-complete    — stage + commit after manual resolution (#100)
// ── Phase 5: File history ────────────────────────────────────────────────────
// GET  /api/git/show?sha=&path=   — fetch file content at a specific commit
// POST /api/git/restore           — restore file to a specific commit state

import type { Express, Request, Response } from 'express';
import { simpleGit } from 'simple-git';
import { resolve, join } from 'node:path';
import type { ServerContext } from '../context.js';
import { sanitizeGitError } from '../utils/errorSanitizer.js';
import { isInsideDir } from '../utils/pathGuard.js';
import { badRequest, notFound, serverError } from '../utils/errorResponse.js';

const SAFE_SHA = /^[0-9a-f]{4,64}$/i;

// Wraps a git operation with a hard timeout so network-level hangs don't block the server.
const GIT_NETWORK_TIMEOUT_MS = 30_000;
function gitWithTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`git ${label} timed out after ${GIT_NETWORK_TIMEOUT_MS / 1000}s`)),
        GIT_NETWORK_TIMEOUT_MS,
      )
    ),
  ]);
}

/**
 * Registers the Git integration API:
 *   GET  /api/git/status         — working-tree status
 *   GET  /api/git/log            — commit history (optional ?path=)
 *   GET  /api/git/branches       — list branches
 *   POST /api/git/checkout       — switch branch (with auto-stash)
 *   POST /api/git/commit         — stage all and commit
 *   POST /api/git/push           — push to remote
 *   POST /api/git/pull           — pull from remote
 *   GET  /api/git/remote         — list remotes
 *   POST /api/git/remote         — add/update remote
 *   GET  /api/git/diff           — unstaged diff or commit diff
 *   GET  /api/git/show           — file content at a commit (SHA + path)
 *   POST /api/git/restore        — restore file to HEAD
 *   GET  /api/git/conflicts      — list conflicting files
 *   POST /api/git/merge          — merge a branch
 *   POST /api/git/merge-abort    — abort an in-progress merge
 *   POST /api/git/merge-complete — complete a resolved merge
 */
export function registerGitApi(app: Express, ctx: ServerContext) {
  const pagesDir = resolve(join(ctx.cwd, ctx.config.pages_dir));
  const git = simpleGit(ctx.cwd);

  app.get('/api/git/log', async (req: Request, res: Response) => {
    try {
      const filePath = typeof req.query['path'] === 'string' ? req.query['path'] : undefined;
      if (filePath) {
        const abs = resolve(join(ctx.cwd, ctx.config.pages_dir, filePath));
        if (!isInsideDir(pagesDir, abs)) {
          return badRequest(res, 'Path outside pages directory');
        }
      }
      const log = filePath
        ? await git.log({ maxCount: 50, file: filePath })
        : await git.log({ maxCount: 50 });
      res.json(log.all);
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });

  app.post('/api/git/commit', async (req: Request, res: Response) => {
    try {
      const { message } = req.body as { message?: string };
      if (!message || typeof message !== 'string') {
        return badRequest(res, 'message required');
      }
      if (message.length > 4096) {
        return badRequest(res, 'Commit message too long (max 4096 characters)');
      }
      await git.add(`${ctx.config.pages_dir}/`);
      const result = await git.commit(message);
      res.json({ ok: true, commit: result.commit });
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });

  app.get('/api/git/diff', async (req: Request, res: Response) => {
    try {
      const sha = typeof req.query['sha'] === 'string' ? req.query['sha'] : undefined;
      if (sha && !SAFE_SHA.test(sha)) {
        return badRequest(res, 'Invalid SHA format');
      }
      // Without sha: return the unstaged working-tree diff
      // With sha: show the diff introduced by that commit
      const diff = sha ? await git.show([sha]) : await git.diff();
      res.json({ diff });
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });

  app.get('/api/git/status', async (_req: Request, res: Response) => {
    try {
      const status = await git.status();
      res.json(status);
    } catch (e) {
      serverError(res, sanitizeGitError(e));
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
      serverError(res, sanitizeGitError(e));
    }
  });

  app.post('/api/git/push', async (_req: Request, res: Response) => {
    try {
      const pushResult = await gitWithTimeout('push', () => git.push('origin'));
      res.json({ ok: true, pushed: pushResult.pushed });
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });

  app.post('/api/git/pull', async (_req: Request, res: Response) => {
    try {
      // Fast-forward only — if not FF-able, return error with message
      const pullResult = await gitWithTimeout('pull', () => git.pull('origin', undefined, ['--ff-only']));
      res.json({
        ok: true,
        summary: { changes: pullResult.summary.changes, insertions: pullResult.summary.insertions, deletions: pullResult.summary.deletions },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hasConflict = msg.includes('CONFLICT') || msg.includes('not possible to fast-forward');
      res.status(hasConflict ? 409 : 500).json({
        error: hasConflict
          ? 'Cannot fast-forward. Remote has diverged. Pull manually or rebase.'
          : sanitizeGitError(e),
        conflict: hasConflict,
      });
    }
  });

  app.patch('/api/git/remote', async (req: Request, res: Response) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== 'string') {
        return badRequest(res, 'url is required');
      }
      // Disallow local file:// remotes and validate basic URL format
      const allowedProtocols = ['https:', 'ssh:', 'git:'];
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return badRequest(res, 'Invalid remote URL');
      }
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        return badRequest(res, 'Remote URL must use https, ssh, or git protocol');
      }
      // Set or add remote
      try {
        await git.remote(['set-url', 'origin', url]);
      } catch {
        await git.addRemote('origin', url);
      }
      res.json({ ok: true });
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });

  // ── Phase 5: Branch management ─────────────────────────────────────────────

  // GET /api/git/branches → { current: string; branches: { name, current, sha, date }[] }
  app.get('/api/git/branches', async (_req: Request, res: Response) => {
    try {
      const summary = await git.branchLocal();
      const branches = summary.all.map(name => ({
        name,
        current: name === summary.current,
        sha:     (summary.branches[name]?.commit ?? '').slice(0, 7),
        date:    summary.branches[name]?.label ?? '',
      }));
      res.json({ current: summary.current, branches });
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });

  // POST /api/git/branches  body: { name: string }  → creates branch from HEAD
  app.post('/api/git/branches', async (req: Request, res: Response) => {
    try {
      const { name } = req.body as { name?: string };
      // Must start with alphanumeric/underscore to prevent flag injection (e.g. --force)
      if (!name || !/^[a-zA-Z0-9_][a-zA-Z0-9\-._/]*$/.test(name)) {
        return badRequest(res, 'valid branch name required');
      }
      await git.checkoutLocalBranch(name);
      res.json({ ok: true, name });
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });

  // POST /api/git/checkout  body: { branch: string }
  // Stashes uncommitted changes, switches branch, re-applies stash if any.
  app.post('/api/git/checkout', async (req: Request, res: Response) => {
    let wasStashed = false;
    try {
      const { branch } = req.body as { branch?: string };
      if (!branch || !/^[a-zA-Z0-9_][a-zA-Z0-9\-._/]*$/.test(branch)) return badRequest(res, 'valid branch name required');

      const status = await git.status();
      wasStashed = !status.isClean();

      if (wasStashed) {
        await git.stash(['push', '-m', `qs-autostash before switching to ${branch}`]);
      }

      await git.checkout(branch);

      if (wasStashed) {
        try {
          await git.stash(['pop']);
        } catch {
          // Stash pop conflict — leave stash in place, surface warning
          return res.json({ ok: true, branch, stashConflict: true });
        }
      }

      res.json({ ok: true, branch, stashed: wasStashed });
    } catch (e) {
      if (wasStashed) {
        try { await git.stash(['pop']); } catch { /* ignore pop failure */ }
      }
      serverError(res, sanitizeGitError(e));
    }
  });

  // POST /api/git/merge  body: { branch: string; message?: string }
  // Merges the given branch into the current branch (--no-ff).
  app.post('/api/git/merge', async (req: Request, res: Response) => {
    try {
      const { branch, message } = req.body as { branch?: string; message?: string };
      if (!branch || !/^[a-zA-Z0-9_][a-zA-Z0-9\-._/]*$/.test(branch)) return badRequest(res, 'valid branch name required');
      const mergeMsg = message ?? `Merge branch '${branch}'`;
      const result = await git.merge([branch, '--no-ff', '-m', mergeMsg]);
      if (result.failed) {
        return res.status(409).json({ error: 'Merge conflict — resolve manually', conflicts: result.conflicts });
      }
      res.json({ ok: true, commit: result.result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('CONFLICT') || msg.includes('conflict')) {
        // Extract conflict file names from git output
        const conflicts: string[] = [];
        for (const line of msg.split('\n')) {
          const m = /CONFLICT.*:\s*(.+)$/.exec(line);
          if (m) conflicts.push(m[1].trim());
        }
        return res.status(409).json({ error: 'Merge conflict', conflicts, details: sanitizeGitError(e) });
      }
      serverError(res, sanitizeGitError(e));
    }
  });

  // POST /api/git/merge-abort — abort an in-progress merge (#100)
  app.post('/api/git/merge-abort', async (_req: Request, res: Response) => {
    try {
      await git.raw(['merge', '--abort']);
      res.json({ ok: true });
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });

  // GET /api/git/conflicts — list currently conflicted files (#100)
  app.get('/api/git/conflicts', async (_req: Request, res: Response) => {
    try {
      const status = await git.status();
      const conflicted = status.conflicted.map(f => f);
      res.json({ conflicted });
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });

  // POST /api/git/merge-complete — finish a merge after manual resolution (#100)
  // Stages all resolved files and creates the merge commit.
  app.post('/api/git/merge-complete', async (_req: Request, res: Response) => {
    try {
      await git.add(ctx.config.pages_dir + '/');
      const result = await git.commit('Merge conflict resolved by quartostone');
      res.json({ ok: true, commit: result.commit });
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });

  // ── Phase 5: File history ──────────────────────────────────────────────────

  // GET /api/git/show?sha=<hash>&path=<file>
  // Returns the content of `path` at commit `sha`.
  app.get('/api/git/show', async (req: Request, res: Response) => {
    try {
      const sha  = typeof req.query['sha']  === 'string' ? req.query['sha']  : undefined;
      const path = typeof req.query['path'] === 'string' ? req.query['path'] : undefined;
      if (!sha || !SAFE_SHA.test(sha)) return badRequest(res, 'Invalid or missing sha');
      if (!path) return badRequest(res, 'path required');
      if (path.includes(':') || path.startsWith('-')) return badRequest(res, 'Invalid path');
      if (!isInsideDir(pagesDir, resolve(join(ctx.cwd, path)))) return badRequest(res, 'Path outside pages directory');
      // git show sha:path
      const content = await git.show([`${sha}:${path}`]);
      res.json({ content, sha, path });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('does not exist') || msg.includes('bad object') || msg.includes('not found')) {
        return notFound(res, 'File not found at that commit');
      }
      serverError(res, sanitizeGitError(e));
    }
  });

  // POST /api/git/restore  body: { sha: string; path: string }
  // Checks out `path` from commit `sha` into the working tree (HEAD unchanged).
  app.post('/api/git/restore', async (req: Request, res: Response) => {
    try {
      const { sha, path } = req.body as { sha?: string; path?: string };
      if (!sha || !SAFE_SHA.test(sha)) return badRequest(res, 'Invalid or missing sha');
      if (!path) return badRequest(res, 'path required');
      if (!isInsideDir(pagesDir, resolve(join(ctx.cwd, path)))) return badRequest(res, 'Path outside pages directory');
      await git.checkout([sha, '--', path]);
      res.json({ ok: true, sha, path });
    } catch (e) {
      serverError(res, sanitizeGitError(e));
    }
  });
}
