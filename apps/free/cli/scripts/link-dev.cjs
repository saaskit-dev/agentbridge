#!/usr/bin/env node
/**
 * link-dev.cjs - Create symlinks for free-dev and free-mcp-dev
 *
 * Creates global symlinks pointing to the local development build,
 * while leaving the stable npm versions of `free` / `free-mcp` untouched.
 *
 * Usage: pnpm link:dev        (or pnpm run link:dev)
 * Undo:  pnpm unlink:dev
 */

const { execFileSync } = require('child_process');
const { join, dirname } = require('path');
const fs = require('fs');

const projectRoot = dirname(__dirname);

/** Binaries to link: [globalName, localPath] */
const BINS = [
  ['free-dev', join(projectRoot, 'dist', 'cli-dev.mjs')],
  ['free-mcp-dev', join(projectRoot, 'dist', 'mcp-bridge-dev.mjs')],
];

const action = process.argv[2] || 'link';

function getGlobalBinDir() {
  try {
    const npmBin = execFileSync('npm', ['bin', '-g'], { encoding: 'utf8' }).trim();
    if (fs.existsSync(npmBin)) return npmBin;
  } catch (_) { /* fall through */ }

  if (process.platform === 'darwin') {
    for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
      if (fs.existsSync(dir)) return dir;
    }
  }
  return '/usr/local/bin';
}

function link() {
  const globalBin = getGlobalBinDir();

  for (const [name, source] of BINS) {
    const target = join(globalBin, name);
    console.log(`\nLinking ${name}...`);
    console.log(`  Source: ${source}`);
    console.log(`  Target: ${target}`);

    if (!fs.existsSync(source)) {
      console.error(`  ❌ Source does not exist. Run 'pnpm build' first.`);
      continue;
    }

    // Remove existing
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || stat.isFile()) {
        fs.unlinkSync(target);
      }
    } catch (_) { /* doesn't exist */ }

    try {
      fs.symlinkSync(source, target);
      // Make executable
      fs.chmodSync(source, 0o755);
      console.log(`  ✅ Linked`);
    } catch (e) {
      if (e.code === 'EACCES') {
        console.error(`  ❌ Permission denied. Try: sudo pnpm link:dev`);
      } else {
        console.error(`  ❌ ${e.message}`);
      }
    }
  }

  console.log('\nDone. You can now use:');
  console.log('  free         → stable npm version (unchanged)');
  console.log('  free-dev     → local dev build (APP_ENV=development, ~/.free-dev)');
  console.log('  free-mcp-dev → local dev MCP bridge');
  console.log('\nTo undo: pnpm unlink:dev');
}

function unlink() {
  const globalBin = getGlobalBinDir();

  for (const [name, source] of BINS) {
    const target = join(globalBin, name);
    console.log(`\nUnlinking ${name}...`);

    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(target);
        if (linkTarget === source || linkTarget.includes('free-cli')) {
          fs.unlinkSync(target);
          console.log(`  ✅ Removed`);
        } else {
          console.log(`  ⚠️  Points elsewhere: ${linkTarget} — skipping`);
        }
      } else {
        console.log(`  ⚠️  Not a symlink — skipping`);
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.log(`  ✅ Already removed`);
      } else if (e.code === 'EACCES') {
        console.error(`  ❌ Permission denied. Try: sudo pnpm unlink:dev`);
      } else {
        console.error(`  ❌ ${e.message}`);
      }
    }
  }
}

if (action === 'unlink') {
  unlink();
} else {
  link();
}
