#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

function parseMaxBuildNumber(raw) {
  const payload = JSON.parse(raw);
  const builds = Array.isArray(payload.data) ? payload.data : [];

  return builds.reduce((currentMax, build) => {
    const value = Number.parseInt(build?.attributes?.version ?? '', 10);
    return Number.isFinite(value) ? Math.max(currentMax, value) : currentMax;
  }, 0);
}

function writeAscPrivateKeyIfNeeded(env) {
  if (env.ASC_PRIVATE_KEY_PATH || !env.ASC_PRIVATE_KEY) {
    return { env, cleanup: () => {} };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbridge-asc-key-'));
  const keyPath = path.join(tempDir, `AuthKey_${env.ASC_KEY_ID || 'ci'}.p8`);
  fs.writeFileSync(keyPath, `${env.ASC_PRIVATE_KEY}\n`, { mode: 0o600 });

  return {
    env: {
      ...env,
      ASC_PRIVATE_KEY_PATH: keyPath,
      ASC_BYPASS_KEYCHAIN: env.ASC_BYPASS_KEYCHAIN || '1',
      ASC_STRICT_AUTH: env.ASC_STRICT_AUTH || '1',
    },
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function queryAscNextBuildNumber(appId, env = process.env) {
  const auth = writeAscPrivateKeyIfNeeded(env);

  try {
    const raw = execFileSync('asc', ['builds', 'list', '--app', appId, '--output', 'json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        ...auth.env,
      },
    });
    return String(parseMaxBuildNumber(raw) + 1);
  } finally {
    auth.cleanup();
  }
}

function queryGitCommitCount(env = process.env) {
  const raw = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env,
      ...env,
    },
  }).trim();

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid git commit count: ${raw}`);
  }

  return String(value + 1);
}

function getNextBuildNumber(env = process.env) {
  const appId = env.ASC_APP_ID || env.IOS_ASC_APP_ID || '';

  if (appId) {
    try {
      return queryAscNextBuildNumber(appId, env);
    } catch (error) {
      console.warn(`Falling back to git-based build number: ${String(error)}`);
    }
  }

  return queryGitCommitCount(env);
}

if (require.main === module) {
  process.stdout.write(`${getNextBuildNumber()}\n`);
}

module.exports = {
  getNextBuildNumber,
  parseMaxBuildNumber,
  queryAscNextBuildNumber,
  queryGitCommitCount,
};
