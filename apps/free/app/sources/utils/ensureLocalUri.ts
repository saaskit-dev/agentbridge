import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('utils/ensureLocalUri');

/** Ensure a photo asset has a locally-available URI, downloading from iCloud if needed. */
export async function ensureLocalUri(
  assetUri: string,
  assetId?: string | null
): Promise<string | null> {
  if (Platform.OS === 'web') {
    return assetUri || null;
  }

  if (assetUri && (assetUri.startsWith('file://') || assetUri.startsWith('content://'))) {
    return assetUri;
  }

  if (!assetId) {
    return assetUri || null;
  }

  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId);

    if (info.localUri) {
      logger.debug('[ensureLocalUri] got localUri', { assetId });
      return info.localUri;
    }

    if (info.isNetworkAsset) {
      logger.info('[ensureLocalUri] waiting for iCloud download', { assetId });
      return await waitForLocalUri(assetId, 30_000);
    }

    logger.warn('[ensureLocalUri] no localUri available', { assetId });
    return null;
  } catch (err) {
    logger.error('[ensureLocalUri] failed', err, { assetId });
    return assetUri || null;
  }
}

async function waitForLocalUri(assetId: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(assetId);
      if (info.localUri) {
        logger.info('[ensureLocalUri] download completed', {
          assetId,
          elapsed: Date.now() - start,
        });
        return info.localUri;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  logger.warn('[ensureLocalUri] timeout', { assetId });
  return null;
}
