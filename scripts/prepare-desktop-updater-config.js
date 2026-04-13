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

  const trimmed = value.trim();

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded.includes('untrusted comment:')) {
      return trimmed;
    }
  } catch {}

  const normalizedText = trimmed
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n');

  if (!normalizedText.includes('untrusted comment:')) {
    return trimmed;
  }

  return Buffer.from(normalizedText, 'utf8').toString('base64');
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
