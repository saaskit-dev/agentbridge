#!/usr/bin/env node

const fs = require('fs');

const rawKey = process.env.TAURI_SIGNING_PRIVATE_KEY_RAW || process.env.TAURI_SIGNING_PRIVATE_KEY;
const githubEnvPath = process.env.GITHUB_ENV;

function normalizeSigningKey(value) {
  if (!value) {
    return value;
  }

  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines
    .filter((line) => !line.startsWith('untrusted comment:'))
    .flatMap((line) => {
      const trimmed = line.replace(/^['"]|['"]$/g, '');
      const matches = trimmed.match(/[A-Za-z0-9+/=]{16,}/g);
      return matches || [];
    });

  if (candidates.length > 0) {
    return candidates[candidates.length - 1];
  }

  return value.trim();
}

if (!rawKey) {
  console.error('Missing TAURI_SIGNING_PRIVATE_KEY_RAW');
  process.exit(1);
}

const normalizedKey = normalizeSigningKey(rawKey);

if (!normalizedKey) {
  console.error('Failed to normalize TAURI_SIGNING_PRIVATE_KEY_RAW');
  process.exit(1);
}

if (githubEnvPath) {
  fs.appendFileSync(githubEnvPath, `TAURI_SIGNING_PRIVATE_KEY=${normalizedKey}\n`);
  console.log('Normalized Tauri signing private key for GitHub Actions');
} else {
  process.stdout.write(`${normalizedKey}\n`);
}
