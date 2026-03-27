import { Platform } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';
import { apiSocket } from './apiSocket';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

export interface AttachmentRef {
  id: string;
  mimeType: string;
  thumbhash?: string;
  filename?: string;
}

const logger = new Logger('app/sync/attachmentUpload');

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.75;
const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

/**
 * Compress an image to fit within MAX_DIMENSION and MAX_SIZE_BYTES.
 * Returns the local URI and mimeType of the compressed image.
 */
async function compressImage(
  uri: string,
  originalMimeType: string | null
): Promise<{ uri: string; mimeType: string }> {
  // PNG with alpha → keep PNG, everything else → JPEG
  const isPng = originalMimeType === 'image/png';
  const format = isPng ? SaveFormat.PNG : SaveFormat.JPEG;
  const mimeType = isPng ? 'image/png' : 'image/jpeg';

  const result = await manipulateAsync(
    uri,
    [{ resize: { width: MAX_DIMENSION } }],
    {
      compress: isPng ? 1 : JPEG_QUALITY,
      format,
    }
  );

  return { uri: result.uri, mimeType };
}

/**
 * Read file bytes as ArrayBuffer, cross-platform.
 */
async function readFileBytes(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return await res.arrayBuffer();
  }
  const file = new File(uri);
  return await file.arrayBuffer();
}

/**
 * Get file size in bytes, cross-platform.
 */
function getFileSize(uri: string): number {
  if (Platform.OS === 'web') {
    // Web: size will be checked after reading bytes
    return 0;
  }
  const file = new File(uri);
  return file.size;
}

/**
 * Copy asset URI to a persistent cache location to prevent iOS from reclaiming it.
 */
function copyToPersistentUri(asset: ImagePickerAsset): string {
  if (Platform.OS === 'web') {
    return asset.uri;
  }
  const ext = asset.uri.split('.').pop() || 'jpg';
  const destName = `attachment_${Date.now()}.${ext}`;
  const src = new File(asset.uri);
  const dest = new File(Paths.cache, destName);
  if (dest.exists) dest.delete();
  src.copy(dest);
  return dest.uri;
}

export interface UploadResult {
  attachmentRef: AttachmentRef;
  localUri: string;
}

/**
 * In-memory cache: attachmentId → localUri.
 * Used to render images in the current session (before they become history).
 * Cleared on app restart — historical messages fall back to thumbhash placeholders.
 */
const localUriCache = new Map<string, string>();

export function getAttachmentLocalUri(attachmentId: string): string | undefined {
  return localUriCache.get(attachmentId);
}

/**
 * Pick → copy → compress → upload a single image attachment.
 * Returns the AttachmentRef (for the message) and the localUri (for preview).
 *
 * Throws on failure (caller should catch and show error).
 */
export async function uploadAttachment(
  asset: ImagePickerAsset,
  sessionId: string
): Promise<UploadResult> {
  logger.info('[uploadAttachment] start', {
    sessionId,
    assetUri: asset.uri.slice(-40),
    assetMime: asset.mimeType,
    width: asset.width,
    height: asset.height,
    fileName: asset.fileName,
  });

  // 1. Reject GIF
  const assetMime = asset.mimeType ?? (asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg');
  if (assetMime === 'image/gif') {
    throw new Error('GIF images are not supported');
  }

  // 2. Copy to persistent location (iOS temp URIs get reclaimed)
  let persistentUri: string;
  try {
    persistentUri = copyToPersistentUri(asset);
    logger.info('[uploadAttachment] copied to persistent uri', {
      sessionId,
      persistentUri: persistentUri.slice(-40),
    });
  } catch (err) {
    logger.error('[uploadAttachment] copy failed', err, { sessionId, assetUri: asset.uri.slice(-40) });
    throw new Error(`Failed to copy image: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Compress
  const needsResize =
    (asset.width && asset.width > MAX_DIMENSION) ||
    (asset.height && asset.height > MAX_DIMENSION);

  let compressedUri: string;
  let mimeType: string;

  try {
    if (needsResize || assetMime !== 'image/png') {
      logger.info('[uploadAttachment] compressing', { sessionId, needsResize, assetMime });
      const result = await compressImage(persistentUri, assetMime);
      compressedUri = result.uri;
      mimeType = result.mimeType;
      logger.info('[uploadAttachment] compressed', {
        sessionId,
        compressedUri: compressedUri.slice(-40),
        mimeType,
      });
    } else {
      compressedUri = persistentUri;
      mimeType = assetMime;
      logger.info('[uploadAttachment] skip compress (small PNG)', { sessionId });
    }
  } catch (err) {
    logger.error('[uploadAttachment] compress failed', err, { sessionId });
    throw new Error(`Failed to compress image: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Check size & read bytes
  let bytes: ArrayBuffer;
  try {
    if (Platform.OS === 'web') {
      bytes = await readFileBytes(compressedUri);
    } else {
      const size = getFileSize(compressedUri);
      logger.info('[uploadAttachment] file size', { sessionId, sizeBytes: size });
      if (size > MAX_SIZE_BYTES) {
        throw new Error(`Image too large (${(size / 1024 / 1024).toFixed(1)}MB > 8MB limit)`);
      }
      bytes = await readFileBytes(compressedUri);
    }
    if (bytes.byteLength > MAX_SIZE_BYTES) {
      throw new Error(`Image too large (${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB > 8MB limit)`);
    }
    logger.info('[uploadAttachment] bytes read', { sessionId, byteLength: bytes.byteLength });
  } catch (err) {
    if (err instanceof Error && err.message.includes('too large')) throw err;
    logger.error('[uploadAttachment] read bytes failed', err, { sessionId });
    throw new Error(`Failed to read image: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Upload via socket with 30s timeout
  const socketStatus = apiSocket.getStatus();
  logger.info('[uploadAttachment] emitting upload-attachment', {
    sessionId,
    mimeType,
    byteLength: bytes.byteLength,
    socketStatus,
  });

  if (socketStatus !== 'connected') {
    throw new Error(`Socket not connected (status: ${socketStatus})`);
  }

  try {
    const ack = await apiSocket.emitWithAckTimeout<{
      ok: boolean;
      attachmentId?: string;
      error?: string;
    }>(
      'upload-attachment',
      {
        sessionId,
        data: bytes,
        mimeType,
        filename: asset.fileName ?? undefined,
      },
      30_000
    );

    logger.info('[uploadAttachment] ack received', {
      sessionId,
      ok: ack.ok,
      attachmentId: ack.attachmentId,
      error: ack.error,
    });

    if (!ack.ok || !ack.attachmentId) {
      throw new Error(ack.error ?? 'Upload failed (server returned ok:false)');
    }

    localUriCache.set(ack.attachmentId, compressedUri);

    return {
      attachmentRef: {
        id: ack.attachmentId,
        mimeType,
        filename: asset.fileName ?? undefined,
      },
      localUri: compressedUri,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Distinguish timeout from other errors
    const isTimeout = msg.includes('timeout') || msg.includes('timed out');
    logger.error('[uploadAttachment] socket emit failed', err, {
      sessionId,
      isTimeout,
      socketStatus: apiSocket.getStatus(),
    });
    throw new Error(isTimeout
      ? 'Upload timed out — server may not have received the event. Is the server running latest code?'
      : `Upload failed: ${msg}`
    );
  }
}
