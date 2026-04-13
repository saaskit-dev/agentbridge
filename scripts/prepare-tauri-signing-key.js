#!/usr/bin/env node

const fs = require('fs');

const rawKey = process.env.TAURI_SIGNING_PRIVATE_KEY_RAW || process.env.TAURI_SIGNING_PRIVATE_KEY;
const githubEnvPath = process.env.GITHUB_ENV;

function normalizeSigningKey(value) {
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
