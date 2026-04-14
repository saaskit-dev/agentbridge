#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

function normalizeKey(value) {
  if (!value) return '';
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

function readFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function statMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function resolveDefaultKeySet() {
  const tauriDir = path.join(os.homedir(), '.tauri');
  if (!fs.existsSync(tauriDir)) {
    return null;
  }

  const preferredBase = process.env.TAURI_DESKTOP_KEY_BASENAME || '';
  const matches = [];

  for (const entry of fs.readdirSync(tauriDir)) {
    if (!entry.endsWith('.key')) continue;
    const base = entry.slice(0, -'.key'.length);
    const privateKeyPath = path.join(tauriDir, `${base}.key`);
    const publicKeyPath = path.join(tauriDir, `${base}.key.pub`);
    const passwordPath = path.join(tauriDir, `${base}.password`);
    if (!fs.existsSync(publicKeyPath) || !fs.existsSync(passwordPath)) continue;
    matches.push({
      base,
      privateKeyPath,
      publicKeyPath,
      passwordPath,
      mtimeMs: Math.max(
        statMtime(privateKeyPath),
        statMtime(publicKeyPath),
        statMtime(passwordPath)
      ),
    });
  }

  if (preferredBase) {
    const preferred = matches.find((entry) => entry.base === preferredBase);
    if (preferred) {
      return preferred;
    }
  }

  return matches
    .filter((entry) => entry.base.startsWith('free-desktop'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

let updaterPublicKey =
  process.env.TAURI_UPDATER_PUBLIC_KEY ||
  readFileIfExists(process.env.TAURI_UPDATER_PUBLIC_KEY_FILE);

let signingPrivateKey =
  process.env.TAURI_SIGNING_PRIVATE_KEY_RAW ||
  process.env.TAURI_SIGNING_PRIVATE_KEY ||
  readFileIfExists(process.env.TAURI_SIGNING_PRIVATE_KEY_FILE);

let signingPassword =
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ||
  readFileIfExists(process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD_FILE).trim();

let fallbackKeySet = null;
if (!updaterPublicKey || !signingPrivateKey || !signingPassword) {
  fallbackKeySet = resolveDefaultKeySet();
  if (fallbackKeySet) {
    updaterPublicKey ||= readFileIfExists(fallbackKeySet.publicKeyPath);
    signingPrivateKey ||= readFileIfExists(fallbackKeySet.privateKeyPath);
    signingPassword ||= readFileIfExists(fallbackKeySet.passwordPath).trim();
  }
}

const exportsToWrite = [];

if (updaterPublicKey) {
  exportsToWrite.push(
    `export TAURI_UPDATER_PUBLIC_KEY=${shellQuote(normalizeKey(updaterPublicKey))}`
  );
}

if (signingPrivateKey) {
  exportsToWrite.push(
    `export TAURI_SIGNING_PRIVATE_KEY=${shellQuote(normalizeKey(signingPrivateKey))}`
  );
}

if (signingPassword) {
  exportsToWrite.push(
    `export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=${shellQuote(signingPassword)}`
  );
}

if (fallbackKeySet) {
  exportsToWrite.push(
    `export TAURI_DESKTOP_KEY_BASENAME=${shellQuote(fallbackKeySet.base)}`
  );
}

process.stdout.write(exportsToWrite.join('\n'));
if (exportsToWrite.length > 0) {
  process.stdout.write('\n');
}
