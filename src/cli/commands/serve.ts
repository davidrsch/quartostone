// src/cli/commands/serve.ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { createServer } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

function openBrowser(url: string): void {
  const p = platform();
  if (p === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else if (p === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', shell: false }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

export async function serve(options: { port: number | undefined; open: boolean }) {
  const cwd = resolve('.');
  const configPath = resolve(cwd, '_quartostone.yml');

  if (!existsSync(configPath)) {
    console.error(
      '\n✗ No _quartostone.yml found in the current directory.\n' +
        '  Run `quartostone init` first, or navigate to a Quartostone workspace.\n'
    );
    process.exit(1);
  }

  const config = await loadConfig(configPath);
  const port = options.port ?? config.port ?? 4242;

  // When running from source via tsx, __dirname in the server module resolves
  // to src/server/ instead of dist/server/, so ../client would be wrong.
  // Explicitly resolve the built client directory from the workspace root.
  const clientDist = resolve(cwd, 'dist', 'client');
  const { server, token } = await createServer({ cwd, config, port, clientDist });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n✓ Quartostone running at http://localhost:${port}`);
    console.log(`  Auth token: ${token}  (also available at GET /api/session)`);
    const shouldOpen = options.open !== undefined ? options.open : config.open_browser;
    if (shouldOpen) {
      openBrowser(`http://localhost:${port}`);
    }
  });

  process.on('SIGINT', () => {
    console.log('\n✓ Quartostone stopped.');
    process.exit(0);
  });
}
