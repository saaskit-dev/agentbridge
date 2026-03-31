#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

/**
 * Run ripgrep and return stdout/stderr/exit code.
 */
function runRg() {
  return spawnSync(
    'rg',
    [
      '-n',
      '^import .* from [\'"]@/(components|realtime)/',
      'apps/free/app/sources/sync',
      '--glob',
      '*.{ts,tsx}',
    ],
    { encoding: 'utf8' }
  );
}

/**
 * Entry point for layer dependency guard.
 * Fails when sync layer has forbidden static imports.
 */
function main() {
  const result = runRg();

  if (result.status === 0) {
    process.stderr.write('Forbidden static imports found in sync layer:\n');
    process.stderr.write(result.stdout || '');
    process.exit(1);
  }

  if (result.status === 1) {
    process.stdout.write('Layer check passed: no forbidden static imports in sync layer.\n');
    process.exit(0);
  }

  process.stderr.write(result.stderr || 'Layer check failed due to rg execution error.\n');
  process.exit(2);
}

main();
