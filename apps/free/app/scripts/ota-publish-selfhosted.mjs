#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const channel = process.argv[2] || process.env.OTA_CHANNEL || 'production';
const message = process.env.OTA_MESSAGE || `OTA ${new Date().toISOString()}`;
const platformArg = process.env.OTA_PLATFORM || 'all';
const serverUrl = process.env.OTA_SERVER_URL || '';
const serverToken = process.env.OTA_SERVER_TOKEN || '';
const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const githubRepository = process.env.OTA_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || readRepositorySlug();

if (!serverUrl) {
  throw new Error('OTA_SERVER_URL is required');
}
if (!serverToken) {
  throw new Error('OTA_SERVER_TOKEN is required');
}
if (!githubToken) {
  throw new Error('GITHUB_TOKEN or GH_TOKEN is required');
}
if (!githubRepository) {
  throw new Error('OTA_GITHUB_REPOSITORY or GITHUB_REPOSITORY is required');
}

const appDir = process.cwd();
const outDir = mkdtempSync(path.join(tmpdir(), 'free-ota-'));
const releaseId = randomUUID();
const createdAt = new Date().toISOString();
const tagName = `ota-${channel}-${releaseId}`;
const uploadedAssetNames = new Set();

function readRepositorySlug() {
  try {
    const rootPackage = JSON.parse(readFileSync(path.resolve(process.cwd(), '../../../package.json'), 'utf8'));
    const repoUrl = rootPackage.repository?.url || '';
    const match = String(repoUrl).match(/github\.com[:/](.+?)(?:\.git)?$/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: appDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function githubApi(pathname) {
  return `https://api.github.com${pathname}`;
}

async function githubRequest(pathname, init = {}) {
  const response = await fetch(githubApi(pathname), {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${githubToken}`,
      'x-github-api-version': '2022-11-28',
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status} ${await response.text()}`);
  }

  return response;
}

async function createGitHubRelease() {
  const response = await githubRequest(`/repos/${githubRepository}/releases`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      tag_name: tagName,
      name: `OTA ${channel} ${releaseId.slice(0, 8)}`,
      body: `${message}\n\nchannel: ${channel}\nreleaseId: ${releaseId}`,
      draft: false,
      prerelease: channel !== 'production',
      target_commitish: process.env.GITHUB_SHA || undefined,
    }),
  });

  return response.json();
}

async function uploadReleaseAsset(uploadUrlTemplate, assetName, buffer, contentType) {
  if (uploadedAssetNames.has(assetName)) {
    return null;
  }

  const uploadUrl = uploadUrlTemplate.replace('{?name,label}', `?name=${encodeURIComponent(assetName)}`);
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${githubToken}`,
      'content-type': contentType,
      'content-length': String(buffer.length),
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    body: buffer,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload GitHub release asset ${assetName}: ${response.status} ${await response.text()}`);
  }

  uploadedAssetNames.add(assetName);
  return response.json();
}

function base64UrlSha256(buffer) {
  return createHash('sha256')
    .update(buffer)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function contentTypeForExtension(ext) {
  switch ((ext || '').toLowerCase()) {
    case '.js':
    case '.hbc':
      return 'application/javascript';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

function relToUrl(rel) {
  return rel.split(path.sep).join('/');
}

function githubReleaseAssetUrl(assetName) {
  return `https://github.com/${githubRepository}/releases/download/${tagName}/${encodeURIComponent(assetName)}`;
}

function toAssetName(platform, relativePath) {
  return `${platform}--${relToUrl(relativePath).replace(/\//g, '__')}`;
}

try {
  run('./node_modules/.bin/expo', [
    'export',
    '--platform',
    platformArg,
    '--output-dir',
    outDir,
    '--dump-assetmap',
  ]);

  const publicConfig = JSON.parse(run('./node_modules/.bin/expo', ['config', '--type', 'public', '--json']));
  const metadataPath = path.join(outDir, 'metadata.json');
  const assetMapPath = path.join(outDir, 'assetmap.json');
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const assetMap = JSON.parse(readFileSync(assetMapPath, 'utf8'));
  const githubRelease = await createGitHubRelease();

  await uploadReleaseAsset(githubRelease.upload_url, 'metadata.json', readFileSync(metadataPath), 'application/json');
  await uploadReleaseAsset(githubRelease.upload_url, 'assetmap.json', readFileSync(assetMapPath), 'application/json');

  const fileHashToAsset = new Map();
  for (const [assetKey, asset] of Object.entries(assetMap)) {
    for (const fileHash of asset.fileHashes || []) {
      fileHashToAsset.set(fileHash, {
        assetKey,
        type: asset.type,
      });
    }
  }

  const platforms = [];
  const uploadBase = serverUrl.replace(/\/$/, '');

  for (const platform of Object.keys(metadata.fileMetadata)) {
    if (platform !== 'ios' && platform !== 'android') continue;

    const platformMeta = metadata.fileMetadata[platform];
    const bundleRel = platformMeta.bundle;
    const bundleBuffer = readFileSync(path.join(outDir, bundleRel));
    const bundleAssetName = toAssetName(platform, bundleRel);
    await uploadReleaseAsset(
      githubRelease.upload_url,
      bundleAssetName,
      bundleBuffer,
      contentTypeForExtension(path.extname(bundleRel) || '.hbc')
    );
    const launchAssetUrl = githubReleaseAssetUrl(bundleAssetName);

    const manifestAssets = [];
    for (const asset of platformMeta.assets) {
      const assetRel = asset.path;
      const buffer = readFileSync(path.join(outDir, assetRel));
      const match = fileHashToAsset.get(path.basename(assetRel));
      const fileExtension = asset.ext ? `.${asset.ext}` : path.extname(assetRel) || undefined;
      const assetName = toAssetName(platform, assetRel);

      await uploadReleaseAsset(
        githubRelease.upload_url,
        assetName,
        buffer,
        contentTypeForExtension(fileExtension)
      );

      manifestAssets.push({
        key: match?.assetKey || path.basename(assetRel),
        url: githubReleaseAssetUrl(assetName),
        contentType: contentTypeForExtension(fileExtension),
        hash: base64UrlSha256(buffer),
        ...(fileExtension ? { fileExtension } : {}),
      });
    }

    const runtimeVersion = JSON.parse(
      run('./node_modules/.bin/fingerprint', ['fingerprint:generate', '--platform', platform])
    ).hash;

    platforms.push({
      platform,
      runtimeVersion,
      launchAssetUrl,
      manifestPermalink: `${uploadBase}/updates?channel=${encodeURIComponent(channel)}&platform=${platform}&runtimeVersion=${encodeURIComponent(runtimeVersion || 'unknown')}`,
      manifest: {
        id: randomUUID(),
        createdAt,
        runtimeVersion: runtimeVersion || 'unknown',
        launchAsset: {
          key: bundleAssetName,
          url: launchAssetUrl,
          contentType: 'application/javascript',
          hash: base64UrlSha256(bundleBuffer),
          fileExtension: path.extname(bundleRel) || '.hbc',
        },
        assets: manifestAssets,
        metadata: {
          channel,
          platform,
        },
        extra: {
          expoClient: publicConfig.expo,
        },
      },
    });
  }

  const release = {
    id: releaseId,
    channel,
    message,
    source: 'self-hosted',
    gitCommit: process.env.GITHUB_SHA || process.env.OTA_GIT_COMMIT || null,
    createdAt,
    actor: process.env.GITHUB_ACTOR || process.env.USER || null,
    raw: {
      metadata,
      assetMap,
      github: {
        repository: githubRepository,
        tagName,
        releaseId: githubRelease.id,
        releaseUrl: githubRelease.html_url,
      },
    },
    platforms,
  };

  const response = await fetch(`${uploadBase}/updates/admin/releases`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serverToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(release),
  });
  if (!response.ok) {
    throw new Error(`Failed to publish release: ${response.status} ${await response.text()}`);
  }

  process.stdout.write(`${JSON.stringify(release, null, 2)}\n`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
