#!/usr/bin/env node
/**
 * Deploy dist/ to Cursor's amiga-debug extension folder.
 * Cursor loads extensions from ~/.cursor/extensions/, not ~/.vscode/extensions/.
 *
 * Usage: node scripts/deploy-to-cursor.mjs
 * Or: npm run deploy
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

const EXTENSION_PREFIX = 'bartmanabyss.amiga-debug';
const FILES = ['extension.js', 'debugAdapter.js', 'client.js'];

function getCursorExtensionsDir() {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) {
    throw new Error('Could not resolve home directory (USERPROFILE/HOME)');
  }
  return join(home, '.cursor', 'extensions');
}

function findExtensionFolder(extDir) {
  const exact = `${EXTENSION_PREFIX}-1.7.9`;
  if (existsSync(join(extDir, exact))) return exact;
  const entries = readdirSync(extDir, { withFileTypes: true });
  const match = entries.find((e) => e.isDirectory() && e.name.startsWith(EXTENSION_PREFIX + '-'));
  return match ? match.name : null;
}

function main() {
  const extDir = getCursorExtensionsDir();
  const folder = findExtensionFolder(extDir);
  const cursorExt = folder ? join(extDir, folder) : join(extDir, `${EXTENSION_PREFIX}-1.7.9`);
  const targetDist = join(cursorExt, 'dist');

  if (!existsSync(cursorExt)) {
    console.error(`Extension folder not found: ${cursorExt}`);
    console.error('Install the amiga-debug extension in Cursor first.');
    process.exit(1);
  }

  if (!existsSync(targetDist)) {
    mkdirSync(targetDist, { recursive: true });
  }

  let ok = 0;
  for (const file of FILES) {
    const src = join(DIST, file);
    const dst = join(targetDist, file);
    if (!existsSync(src)) {
      console.warn(`Skip ${file}: not found in dist/`);
      continue;
    }
    copyFileSync(src, dst);
    console.log(`  ${file} -> ${targetDist}`);
    ok++;
  }

  if (ok === 0) {
    console.error('No files deployed. Run "npm run compile" first.');
    process.exit(1);
  }

  console.log(`\nDeployed ${ok} file(s) to Cursor extension.`);
  console.log('Reload Cursor window (Ctrl+Shift+P > "Developer: Reload Window") to apply.');
}

main();
