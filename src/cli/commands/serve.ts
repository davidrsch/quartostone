// src/cli/commands/serve.ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

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
  const server = await createServer({ cwd, config, port, clientDist });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n✓ Quartostone running at http://localhost:${port}`);
    const shouldOpen = options.open !== undefined ? options.open : config.open_browser;
    if (shouldOpen) {
      import('node:child_process').then(({ exec }) => {
        const cmd =
          process.platform === 'win32'
            ? `start http://localhost:${port}`
            : process.platform === 'darwin'
              ? `open http://localhost:${port}`
              : `xdg-open http://localhost:${port}`;
        exec(cmd);
      });
    }
  });

  process.on('SIGINT', () => {
    console.log('\n✓ Quartostone stopped.');
    process.exit(0);
  });
}
