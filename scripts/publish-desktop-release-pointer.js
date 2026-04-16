#!/usr/bin/env node

const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const githubRepository = process.env.GITHUB_REPOSITORY || '';
const serverUrl = process.env.DESKTOP_UPDATER_SERVER_URL || process.env.OTA_SERVER_URL || '';
const serverToken = process.env.DESKTOP_UPDATER_SERVER_TOKEN || process.env.OTA_SERVER_TOKEN || '';
const tagName = process.env.DESKTOP_RELEASE_TAG_NAME || '';
const version = process.env.DESKTOP_RELEASE_VERSION || '';
const releaseUrl = process.env.DESKTOP_RELEASE_URL || '';
const channel = process.env.DESKTOP_UPDATER_CHANNEL || 'stable';
const gitCommit = process.env.GITHUB_SHA || process.env.DESKTOP_RELEASE_SHA || null;
const actor = process.env.GITHUB_ACTOR || null;

if (!githubToken) throw new Error('GITHUB_TOKEN or GH_TOKEN is required');
if (!githubRepository) throw new Error('GITHUB_REPOSITORY is required');
if (!serverUrl) throw new Error('DESKTOP_UPDATER_SERVER_URL or OTA_SERVER_URL is required');
if (!serverToken) throw new Error('DESKTOP_UPDATER_SERVER_TOKEN or OTA_SERVER_TOKEN is required');
if (!tagName) throw new Error('DESKTOP_RELEASE_TAG_NAME is required');
if (!version) throw new Error('DESKTOP_RELEASE_VERSION is required');
if (!releaseUrl) throw new Error('DESKTOP_RELEASE_URL is required');

async function githubRequest(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${githubToken}`,
      'x-github-api-version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function main() {
  const release = await githubRequest(
    `/repos/${githubRepository}/releases/tags/${encodeURIComponent(tagName)}`
  );
  const latestJsonAsset = (release.assets || []).find(asset => asset.name === 'latest.json');
  if (!latestJsonAsset?.browser_download_url) {
    throw new Error(`latest.json asset not found on release ${tagName}`);
  }

  const payload = {
    id: tagName,
    channel,
    version,
    tagName,
    releaseUrl,
    latestJsonUrl: latestJsonAsset.browser_download_url,
    createdAt: release.published_at || release.created_at || new Date().toISOString(),
    gitCommit,
    actor,
    notes: release.body || null,
  };

  const response = await fetch(`${serverUrl.replace(/\/$/, '')}/updates/admin/desktop/releases`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serverToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to publish desktop release pointer: ${response.status} ${await response.text()}`);
  }

  process.stdout.write(`${JSON.stringify({ ok: true, tagName, channel, latestJsonUrl: payload.latestJsonUrl }, null, 2)}\n`);
}

main().catch(error => {
  console.error(String(error));
  process.exit(1);
});
