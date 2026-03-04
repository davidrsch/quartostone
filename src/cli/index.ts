// src/cli/index.ts
// Quartostone CLI — `quartostone init` and `quartostone serve`

import { Command, InvalidArgumentError } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { init } from './commands/init.js';
import { serve } from './commands/serve.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string };

const program = new Command();

program
  .name('quartostone')
  .description('A Notion-like, Git-native knowledge base built on Quarto')
  .version(pkg.version);

program
  .command('init [name]')
  .description('Scaffold a new Quartostone workspace')
  .option('-d, --dir <directory>', 'Target directory (default: current directory)')
  .action(async (name: string | undefined, options: { dir?: string }) => {
    await init(name, options);
  });

program
  .command('serve')
  .description('Start the local Quartostone server and open the editor')
  .option('-p, --port <port>', 'Port to listen on (default: 4242)', (val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 1 || n > 65535) {
      throw new InvalidArgumentError('Port must be an integer between 1 and 65535');
    }
    return n;
  })
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (options: { port: number; open: boolean }) => {
    await serve(options);
  });

program.parse();
