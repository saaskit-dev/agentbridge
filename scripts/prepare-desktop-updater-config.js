#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const requireKey = process.argv.includes('--require-key');
const rootDir = path.join(__dirname, '..');
const outputPath = path.join(rootDir, 'apps/free/app/src-tauri/tauri.updater.conf.json');
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY;
const repository = process.env.DESKTOP_UPDATER_REPOSITORY || process.env.GITHUB_REPOSITORY || 'saaskit-dev/agentbridge';

function normalizeUpdaterPublicKey(value) {
  if (!value) {
    return value;
  }

  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return value.trim();
  }

  const nonCommentLines = lines.filter((line) => !line.startsWith('untrusted comment:'));
  return (nonCommentLines[nonCommentLines.length - 1] || lines[lines.length - 1]).trim();
}

if (!publicKey) {
  if (requireKey) {
    console.error('Missing TAURI_UPDATER_PUBLIC_KEY');
    process.exit(1);
  }
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }
  console.log('Skipping updater config generation: TAURI_UPDATER_PUBLIC_KEY not set');
  process.exit(0);
}

const config = {
  bundle: {
    createUpdaterArtifacts: true,
  },
  plugins: {
    updater: {
      pubkey: normalizeUpdaterPublicKey(publicKey),
      endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`],
      windows: {
        installMode: 'passive',
      },
    },
  },
};

fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + '\n');
console.log(`Wrote updater config to ${path.relative(rootDir, outputPath)}`);
