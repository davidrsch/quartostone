// tests/e2e/fixtures/start-server.ts
// Bootstraps a real Quartostone server against the fixture workspace for Playwright E2E tests.
// Invoked by playwright.config.ts webServer.command.

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createServer } from '../../../src/server/index.js';
import { loadConfig } from '../../../src/server/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(__dirname, 'workspace');
const PORT = parseInt(process.env['E2E_PORT'] ?? '4343', 10);

// ── Ensure the fixture workspace is a valid git repo ─────────────────────────
// (The .git directory is gitignored, so it won't exist in a fresh clone.)

function ensureGitRepo() {
  const gitDir = resolve(workspace, '.git');
  if (!existsSync(gitDir)) {
    console.log('[e2e-server] Initialising git repo in fixture workspace...');
    execSync('git init', { cwd: workspace });
    execSync('git config user.email "e2e@quartostone.test"', { cwd: workspace });
    execSync('git config user.name "E2E Test"', { cwd: workspace });
    execSync('git add .', { cwd: workspace });
    execSync('git commit -m "e2e fixture: initial commit"', { cwd: workspace });
  }
}

// ── Write a .gitignore so the fixture .git doesn't pollute the host repo ─────

function ensureGitIgnore() {
  const gitignore = resolve(workspace, '.gitignore');
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, '_site/\n.quartostone-cache/\n');
  }
}

// ── Start server ──────────────────────────────────────────────────────────────

async function main() {
  ensureGitIgnore();
  ensureGitRepo();

  const configPath = resolve(workspace, '_quartostone.yml');
  const config = await loadConfig(configPath);

  // When this fixture runs via tsx, __dirname in server/index.ts resolves to
  // the TypeScript source (src/server/), not the compiled output.  Supply the
  // real dist/client/ path so the editor UI is served correctly.
  const clientDist = join(resolve(__dirname, '../../..'), 'dist', 'client');
  const server = await createServer({ cwd: workspace, config, port: PORT, clientDist });
  server.listen(PORT, () => {
    // Playwright waits for this line that matches the `url` it polls, but it actually
    // polls the URL directly — we just need to keep the process alive.
    console.log(`[e2e-server] Quartostone E2E server running at http://localhost:${PORT}`);
  });

  process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[e2e-server] Failed to start:', err);
  process.exit(1);
});
