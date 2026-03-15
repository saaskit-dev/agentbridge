#!/usr/bin/env node
const { existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');

const distDir = join(__dirname, '..', 'dist');

if (!existsSync(distDir)) {
  console.error('dist directory does not exist');
  process.exit(1);
}

// Calculate hash of all .mjs and .cjs files in dist
const files = readdirSync(distDir)
  .filter(f => f.endsWith('.mjs') || f.endsWith('.cjs'))
  .sort();

if (files.length === 0) {
  console.error('No .mjs or .cjs files found in dist');
  process.exit(1);
}

const hash = createHash('md5');
for (const file of files) {
  const filePath = join(distDir, file);
  const content = readFileSync(filePath);
  hash.update(content);
}

const buildHash = hash.digest('hex');
const buildTime = new Date().toISOString();

// Write build metadata to dist/.build.json
const buildMeta = { hash: buildHash, time: buildTime };
writeFileSync(join(distDir, '.build.json'), JSON.stringify(buildMeta));

// Keep .hash for backward compatibility (daemon version check reads it)
writeFileSync(join(distDir, '.hash'), buildHash);
console.log(`Build hash: ${buildHash}`);
console.log(`Build time: ${buildTime}`);
