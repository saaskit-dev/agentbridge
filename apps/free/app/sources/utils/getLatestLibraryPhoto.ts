import type { ImagePickerAsset } from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { ensureLocalUri } from './ensureLocalUri';

const logger = new Logger('utils/getLatestLibraryPhoto');

export async function getLatestLibraryPhotoAsset(): Promise<ImagePickerAsset | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      logger.debug('[getLatestLibraryPhotoAsset] permission denied');
      return null;
    }

    let assets: MediaLibrary.Asset[];
    try {
      const result = await MediaLibrary.getAssetsAsync({
        first: 1,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      assets = result.assets;
    } catch (sortErr) {
      logger.warn('[getLatestLibraryPhotoAsset] sortBy failed, retrying without sort', {
        error: String(sortErr),
      });
      const result = await MediaLibrary.getAssetsAsync({
        first: 1,
        mediaType: MediaLibrary.MediaType.photo,
      });
      assets = result.assets;
    }

    if (assets.length === 0) {
      return null;
    }

    const a = assets[0];
    const localUri = await ensureLocalUri(a.uri, a.id);
    if (!localUri) {
      logger.warn('[getLatestLibraryPhotoAsset] could not get local URI');
      return null;
    }

    return {
      uri: localUri,
      width: a.width,
      height: a.height,
      mimeType: 'image/jpeg',
      fileName: a.filename ?? 'photo.jpg',
      assetId: a.id,
      type: 'image',
    };
  } catch (e) {
    logger.error('[getLatestLibraryPhotoAsset] failed', { error: String(e) });
    return null;
  }
}
