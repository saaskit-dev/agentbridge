#!/usr/bin/env node

const { execFileSync } = require('child_process');

const appId = process.env.ASC_APP_ID || process.argv[2];

if (!appId) {
  console.error('ASC_APP_ID is required');
  process.exit(1);
}

let raw;
try {
  raw = execFileSync('asc', ['builds', 'list', '--app', appId, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
} catch (error) {
  console.error('Failed to query App Store Connect builds via asc CLI');
  process.exit(error.status || 1);
}

const payload = JSON.parse(raw);
const builds = Array.isArray(payload.data) ? payload.data : [];
const maxBuildNumber = builds.reduce((currentMax, build) => {
  const value = Number.parseInt(build?.attributes?.version ?? '', 10);
  return Number.isFinite(value) ? Math.max(currentMax, value) : currentMax;
}, 0);

process.stdout.write(`${maxBuildNumber + 1}\n`);
