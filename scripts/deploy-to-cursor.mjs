#!/usr/bin/env node
/**
 * Deploy dist/ to installed amiga-debug extension folders.
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

function getExtensionsDir(editorDir) {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) {
    throw new Error('Could not resolve home directory (USERPROFILE/HOME)');
  }
  return join(home, editorDir, 'extensions');
}

function findExtensionFolder(extDir) {
  const entries = readdirSync(extDir, { withFileTypes: true });
  const matches = entries
    .filter((e) => e.isDirectory() && e.name.startsWith(EXTENSION_PREFIX + '-'))
    .map((e) => e.name);
  // Prefer the highest installed version; do not deploy into a stale pinned folder.
  matches.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return matches[0] || null;
}

function deploy(extDir, editorName) {
  if (!existsSync(extDir)) return false;
  const folder = findExtensionFolder(extDir);
  const cursorExt = folder ? join(extDir, folder) : join(extDir, `${EXTENSION_PREFIX}-dev`);
  const targetDist = join(cursorExt, 'dist');

  if (!existsSync(cursorExt)) {
    console.error(`Extension folder not found for ${editorName}: ${cursorExt}`);
    return false;
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
    console.error(`No files deployed to ${editorName}. Run "npm run compile" first.`);
    return false;
  }

  console.log(`\nDeployed ${ok} file(s) to ${editorName} extension.`);
  return true;
}

function main() {
  const deployed = [
    deploy(getExtensionsDir('.cursor'), 'Cursor'),
    deploy(getExtensionsDir('.vscode'), 'VS Code'),
  ].some(Boolean);
  if (!deployed) process.exit(1);
  console.log('Reload the editor window to apply the changes.');
}

main();
