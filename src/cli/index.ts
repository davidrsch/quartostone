// src/cli/index.ts
// Quartostone CLI — `quartostone init` and `quartostone serve`

import { Command } from 'commander';
import { init } from './commands/init.js';
import { serve } from './commands/serve.js';

const program = new Command();

program
  .name('quartostone')
  .description('A Notion-like, Git-native knowledge base built on Quarto')
  .version('0.1.0');

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
  .option('-p, --port <port>', 'Port to listen on (default: 4242)', '4242')
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (options: { port: string; open: boolean }) => {
    await serve(options);
  });

program.parse();
