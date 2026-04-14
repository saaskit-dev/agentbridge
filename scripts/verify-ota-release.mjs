#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const serverUrl = process.env.OTA_SERVER_URL || '';
const serverToken = process.env.OTA_SERVER_TOKEN || '';
const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const githubRepository = process.env.OTA_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || readRepositorySlug();
const releaseId = process.env.OTA_RELEASE_ID || '';
const channel = process.env.OTA_CHANNEL || 'production';
const platform = process.env.OTA_PLATFORM || 'ios';
const runtimeVersion = process.env.OTA_RUNTIME_VERSION || '';

if (!serverUrl) throw new Error('OTA_SERVER_URL is required');
if (!serverToken) throw new Error('OTA_SERVER_TOKEN is required');
if (!githubToken) throw new Error('GITHUB_TOKEN or GH_TOKEN is required');
if (!githubRepository) throw new Error('OTA_GITHUB_REPOSITORY or GITHUB_REPOSITORY is required');
if (!releaseId && !runtimeVersion) {
  throw new Error('Set OTA_RELEASE_ID or OTA_RUNTIME_VERSION');
}

function readRepositorySlug() {
  try {
    const rootPackage = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    const repoUrl = rootPackage.repository?.url || '';
    const match = String(repoUrl).match(/github\.com[:/](.+?)(?:\.git)?$/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function readReleaseFromServer() {
  const base = serverUrl.replace(/\/$/, '');
  const auth = { authorization: `Bearer ${serverToken}` };

  if (releaseId) {
    const data = await fetchJson(`${base}/updates/admin/releases`, { headers: auth });
    const release = (data.releases || []).find(item => item.id === releaseId);
    if (!release) {
      throw new Error(`Release not found on server: ${releaseId}`);
    }
    return release;
  }

  const params = new URLSearchParams({ channel, platform, runtimeVersion });
  const data = await fetchJson(`${base}/updates/admin/latest?${params.toString()}`, { headers: auth });
  if (!data.release) {
    throw new Error(`Latest release not found for ${channel}/${platform}/${runtimeVersion}`);
  }
  return data.release;
}

async function readGitHubAssets(tagName) {
  const release = await fetchJson(`https://api.github.com/repos/${githubRepository}/releases/tags/${encodeURIComponent(tagName)}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${githubToken}`,
      'x-github-api-version': '2022-11-28',
    },
  });

  return new Map(release.assets.map(asset => [asset.name, asset]));
}

function collectExpectedAssetNames(release) {
  const names = new Set(['metadata.json', 'assetmap.json']);
  for (const platformEntry of release.platforms || []) {
    const launchAssetUrl = platformEntry.manifest?.launchAsset?.url || '';
    const launchName = decodeURIComponent(launchAssetUrl.split('/').pop() || '');
    if (launchName) names.add(launchName);
    for (const asset of platformEntry.manifest?.assets || []) {
      const name = decodeURIComponent(String(asset.url).split('/').pop() || '');
      if (name) names.add(name);
    }
  }
  return [...names];
}

function validateManifestUrls(release) {
  for (const platformEntry of release.platforms || []) {
    const urls = [
      platformEntry.launchAssetUrl,
      platformEntry.manifest?.launchAsset?.url,
      ...(platformEntry.manifest?.assets || []).map(asset => asset.url),
    ].filter(Boolean);

    for (const url of urls) {
      if (!String(url).includes('/releases/download/')) {
        throw new Error(`Non-GitHub asset URL detected: ${url}`);
      }
    }
  }
}

const release = await readReleaseFromServer();
const github = release.raw?.github;
if (!github?.tagName) {
  throw new Error('Release metadata is missing raw.github.tagName');
}

validateManifestUrls(release);

const assets = await readGitHubAssets(github.tagName);
const expectedNames = collectExpectedAssetNames(release);
const missing = expectedNames.filter(name => !assets.has(name));
if (missing.length > 0) {
  throw new Error(`Missing GitHub release assets: ${missing.join(', ')}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      releaseId: release.id,
      channel: release.channel,
      githubTag: github.tagName,
      checkedAssets: expectedNames.length,
    },
    null,
    2
  )}\n`
);
