import { kvStore } from '@/sync/cachedKVStore';

const LAST_VIEWED_VERSION_KEY = 'changelog-last-viewed-version';

export function getLastViewedVersion(): number {
  return kvStore.getNumber(LAST_VIEWED_VERSION_KEY) ?? 0;
}

export function setLastViewedVersion(version: number): void {
  kvStore.set(LAST_VIEWED_VERSION_KEY, version);
}

export function hasUnreadChangelog(latestVersion: number): boolean {
  const lastViewed = getLastViewedVersion();
  return latestVersion > lastViewed;
}
