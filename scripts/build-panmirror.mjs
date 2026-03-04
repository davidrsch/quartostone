#!/usr/bin/env node
// scripts/build-panmirror.mjs
// Builds the panmirror UMD bundle from the local quarto-fork workspace and
// places the output in src/client/public/panmirror.js.
//
// Usage:
//   node scripts/build-panmirror.mjs
//
// Prerequisites:
//   - ../quarto-fork must exist (sibling directory)
//   - yarn must be installed globally or via corepack

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const quartoStoneRoot = resolve(__dirname, '..');
const quartoForkRoot = resolve(quartoStoneRoot, '..', 'quarto-fork');
const outDir = resolve(quartoStoneRoot, 'src', 'client', 'public');

// ── Validation ────────────────────────────────────────────────────────────────

if (!existsSync(quartoForkRoot)) {
  console.error(`
ERROR: quarto-fork not found at:
  ${quartoForkRoot}

The panmirror bundle must be built from the quarto-dev/quarto monorepo.
Clone it as a sibling of this workspace:

  git clone https://github.com/quarto-dev/quarto ${quartoForkRoot}

Then run this script again.
`);
  process.exit(1);
}

const panmirrorPkg = resolve(quartoForkRoot, 'apps', 'panmirror', 'package.json');
if (!existsSync(panmirrorPkg)) {
  console.error(`ERROR: apps/panmirror not found in quarto-fork at ${quartoForkRoot}`);
  process.exit(1);
}

// ── Ensure output directory exists ───────────────────────────────────────────

mkdirSync(outDir, { recursive: true });

// ── Install dependencies (if node_modules missing) ───────────────────────────

const nmDir = resolve(quartoForkRoot, 'node_modules');
if (!existsSync(nmDir)) {
  console.log('Installing quarto-fork dependencies (yarn install --frozen-lockfile)...');
  const installResult = spawnSync(
    'yarn',
    ['install', '--frozen-lockfile'],
    { cwd: quartoForkRoot, stdio: 'inherit', shell: true }
  );
  if (installResult.status !== 0) {
    console.error('ERROR: yarn install failed.');
    process.exit(installResult.status ?? 1);
  }
}

// ── Build the panmirror workspace ─────────────────────────────────────────────

console.log(`Building panmirror bundle → ${outDir}/panmirror.js`);

const outDirForwardSlash = outDir.replace(/\\/g, '/');
const buildResult = spawnSync(
  'yarn',
  ['workspace', 'panmirror', 'build'],
  {
    cwd: quartoForkRoot,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PANMIRROR_OUTDIR: outDirForwardSlash },
  }
);

if (buildResult.status !== 0) {
  console.error('ERROR: panmirror build failed.');
  process.exit(buildResult.status ?? 1);
}

const builtFile = resolve(outDir, 'panmirror.js');
if (!existsSync(builtFile)) {
  console.error(`ERROR: build succeeded but ${builtFile} was not created.`);
  process.exit(1);
}

// Report file size
try {
  const { statSync } = await import('node:fs');
  const size = statSync(builtFile).size;
  const sizeMb = (size / 1024 / 1024).toFixed(2);
  console.log(`\n✓ panmirror.js built successfully (${sizeMb} MB): ${builtFile}\n`);
} catch {
  console.log(`\n✓ panmirror.js built successfully: ${builtFile}\n`);
}
