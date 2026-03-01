// src/cli/commands/init.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const QUARTO_YML = `project:
  type: website
  title: "{name}"

website:
  title: "{name}"
  sidebar:
    style: "docked"
    search: true
    contents:
      - pages/index.qmd

format:
  html:
    theme: cosmo
    toc: true
`;

const QUARTOSTONE_YML = `commit_mode: prompt
commit_message_auto: "qs-{alphanum8}"
render_on_save: true
render_scope: file
watch_interval_ms: 300
port: 4242
`;

const INDEX_QMD = `---
title: "Welcome"
date: today
---

# Welcome to {name}

This is your first Quartostone page.
`;

const GITIGNORE = `_site/
node_modules/
.quartostone/
*.log
`;

export async function init(name: string | undefined, options: { dir?: string }) {
  const workspaceName = name ?? 'my-quartostone';
  const targetDir = resolve(options.dir ?? (name ? workspaceName : '.'));

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  mkdirSync(join(targetDir, 'pages'), { recursive: true });

  const fill = (s: string) => s.replaceAll('{name}', workspaceName);

  writeFileSync(join(targetDir, '_quarto.yml'), fill(QUARTO_YML));
  writeFileSync(join(targetDir, '_quartostone.yml'), QUARTOSTONE_YML);
  writeFileSync(join(targetDir, 'pages', 'index.qmd'), fill(INDEX_QMD));
  writeFileSync(join(targetDir, '.gitignore'), GITIGNORE);

  console.log(`\n✓ Quartostone workspace "${workspaceName}" created at ${targetDir}`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${targetDir}`);
  console.log(`  git init && git add . && git commit -m "init"`);
  console.log(`  quartostone serve\n`);
}
