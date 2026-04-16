import { readFromSimpleCache, writeToSimpleCache } from '@/storage/simpleCache';

export type OtaPlatform = 'ios' | 'android';
export type DesktopUpdateChannel = string;

export type OtaReleasePlatformEntry = {
  platform: OtaPlatform;
  runtimeVersion: string | null;
  launchAssetUrl?: string | null;
  manifestPermalink?: string | null;
  manifest?: {
    id: string;
    createdAt: string;
    runtimeVersion: string;
    launchAsset: {
      key: string;
      url: string;
      contentType: string;
      hash: string;
      fileExtension?: string;
    };
    assets: Array<{
      key: string;
      url: string;
      contentType: string;
      hash: string;
      fileExtension?: string;
    }>;
    metadata: Record<string, string>;
    extra: Record<string, unknown>;
  } | null;
};

export type OtaReleaseRecord = {
  id: string;
  channel: string;
  message: string;
  source: 'self-hosted';
  gitCommit: string | null;
  createdAt: string;
  actor: string | null;
  raw: unknown;
  platforms: OtaReleasePlatformEntry[];
};

export type DesktopReleaseRecord = {
  id: string;
  channel: DesktopUpdateChannel;
  version: string;
  tagName: string;
  releaseUrl: string;
  latestJsonUrl: string;
  createdAt: string;
  gitCommit: string | null;
  actor: string | null;
  notes?: string | null;
};

const HISTORY_LIMIT = 20;
const RELEASES_KEY = 'updates:releases';
const DESKTOP_RELEASES_KEY = 'updates:desktop:releases';

export async function listOtaReleases(): Promise<OtaReleaseRecord[]> {
  const raw = await readFromSimpleCache(RELEASES_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as OtaReleaseRecord[];
}

export async function listDesktopReleases(): Promise<DesktopReleaseRecord[]> {
  const raw = await readFromSimpleCache(DESKTOP_RELEASES_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as DesktopReleaseRecord[];
}

export async function saveOtaRelease(record: OtaReleaseRecord): Promise<void> {
  const existing = await listOtaReleases();
  const next = [record, ...existing.filter(item => item.id !== record.id)].slice(0, HISTORY_LIMIT);
  await writeToSimpleCache(RELEASES_KEY, JSON.stringify(next));

  await writeLatestPointers(record);
}

export async function saveDesktopRelease(record: DesktopReleaseRecord): Promise<void> {
  const existing = await listDesktopReleases();
  const next = [record, ...existing.filter(item => item.id !== record.id)].slice(0, HISTORY_LIMIT);
  await writeToSimpleCache(DESKTOP_RELEASES_KEY, JSON.stringify(next));
  await writeToSimpleCache(latestDesktopReleaseKey(record.channel), JSON.stringify(record));
}

export async function readLatestOtaRelease(
  channel: string,
  platform: OtaPlatform,
  runtimeVersion: string
): Promise<OtaReleaseRecord | null> {
  const raw = await readFromSimpleCache(latestReleaseKey(channel, platform, runtimeVersion));
  return raw ? (JSON.parse(raw) as OtaReleaseRecord) : null;
}

export async function readOtaReleaseById(releaseId: string): Promise<OtaReleaseRecord | null> {
  const releases = await listOtaReleases();
  return releases.find(item => item.id === releaseId) || null;
}

export async function readLatestDesktopRelease(
  channel: DesktopUpdateChannel
): Promise<DesktopReleaseRecord | null> {
  const raw = await readFromSimpleCache(latestDesktopReleaseKey(channel));
  return raw ? (JSON.parse(raw) as DesktopReleaseRecord) : null;
}

export async function readDesktopReleaseById(
  releaseId: string
): Promise<DesktopReleaseRecord | null> {
  const releases = await listDesktopReleases();
  return releases.find(item => item.id === releaseId) || null;
}

export async function promoteOtaRelease(releaseId: string): Promise<OtaReleaseRecord | null> {
  const release = await readOtaReleaseById(releaseId);
  if (!release) return null;
  await writeLatestPointers(release);
  return release;
}

export async function promoteDesktopRelease(
  releaseId: string
): Promise<DesktopReleaseRecord | null> {
  const release = await readDesktopReleaseById(releaseId);
  if (!release) return null;
  await writeToSimpleCache(latestDesktopReleaseKey(release.channel), JSON.stringify(release));
  return release;
}

async function writeLatestPointers(record: OtaReleaseRecord): Promise<void> {
  for (const platform of record.platforms) {
    const runtimeKey = platform.runtimeVersion || 'unknown';
    await writeToSimpleCache(
      latestReleaseKey(record.channel, platform.platform, runtimeKey),
      JSON.stringify(record)
    );
  }
}

function latestReleaseKey(channel: string, platform: OtaPlatform, runtimeVersion: string): string {
  return `updates:latest:${channel}:${platform}:${runtimeVersion}`;
}

function latestDesktopReleaseKey(channel: DesktopUpdateChannel): string {
  return `updates:desktop:latest:${channel}`;
}
