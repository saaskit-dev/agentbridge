#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const path = require('node:path');

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore',
  });
} catch {
  process.exit(0);
}

const repoRoot = path.resolve(__dirname, '..');
const hooksPath = '.githooks';

let currentHooksPath = '';
try {
  currentHooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  currentHooksPath = '';
}

if (currentHooksPath === hooksPath) {
  process.exit(0);
}

execFileSync('git', ['config', 'core.hooksPath', hooksPath], {
  cwd: repoRoot,
  stdio: 'ignore',
});
