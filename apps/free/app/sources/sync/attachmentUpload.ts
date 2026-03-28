import { Platform } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File, Directory, Paths } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { apiSocket } from './apiSocket';
import { messageDB } from './messageDB';
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

// ---------------------------------------------------------------------------
// Persistent attachment file storage
// ---------------------------------------------------------------------------

/**
 * Lazy-initialized persistent directory for attachment files (native only).
 * Survives app restarts; only cleaned up when the owning session is deleted.
 */
let _attachmentDir: Directory | null = null;

function getAttachmentDir(): Directory {
  if (!_attachmentDir) {
    _attachmentDir = new Directory(Paths.document, 'attachments');
  }
  if (!_attachmentDir.exists) {
    _attachmentDir.create();
  }
  return _attachmentDir;
}

/** Derive file extension from MIME type. */
function extFromMime(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : 'jpg';
}

/** Build a File reference for a given attachment ID and MIME type. */
function attachmentFile(id: string, mimeType: string): File {
  return new File(getAttachmentDir(), `${id}.${extFromMime(mimeType)}`);
}

// ---------------------------------------------------------------------------
// Web-only: IndexedDB blob store for attachment images
// ---------------------------------------------------------------------------

const WEB_IDB_NAME = 'free-attachment-blobs';
const WEB_IDB_STORE = 'blobs';
let _webDB: IDBDatabase | null = null;

/** Open (or create) the IndexedDB for attachment blobs. Cached after first call. */
function getWebBlobDB(): Promise<IDBDatabase> {
  if (_webDB) return Promise.resolve(_webDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WEB_IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(WEB_IDB_STORE);
    req.onsuccess = () => { _webDB = req.result; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
}

/** Store image bytes in IndexedDB and return a blob URL for immediate use. */
async function storeWebBlob(id: string, data: ArrayBuffer, mimeType: string): Promise<string> {
  const db = await getWebBlobDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WEB_IDB_STORE, 'readwrite');
    tx.objectStore(WEB_IDB_STORE).put({ data, mimeType }, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return URL.createObjectURL(new Blob([data], { type: mimeType }));
}

/** Load image bytes from IndexedDB and return a blob URL, or null if absent. */
async function loadWebBlob(id: string): Promise<string | null> {
  const db = await getWebBlobDB();
  const record = await new Promise<{ data: ArrayBuffer; mimeType: string } | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(WEB_IDB_STORE, 'readonly');
      const req = tx.objectStore(WEB_IDB_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }
  );
  if (!record) return null;
  return URL.createObjectURL(new Blob([record.data], { type: record.mimeType }));
}

/** Delete a list of blobs from IndexedDB. */
async function deleteWebBlobs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getWebBlobDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WEB_IDB_STORE, 'readwrite');
    const store = tx.objectStore(WEB_IDB_STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Cross-platform attachment URI cache
// ---------------------------------------------------------------------------

/**
 * Write-through cache: attachmentId → local URI (file:// on native, blob: on web).
 * Populated on upload and on first disk/IDB hit after restart.
 */
const localUriCache = new Map<string, string>();

/**
 * Synchronous lookup — returns a URI from the in-memory cache or from the
 * native filesystem. Web blobs require async loading via `loadAttachmentUri`.
 */
export function getAttachmentLocalUri(attachmentId: string, mimeType: string): string | undefined {
  const cached = localUriCache.get(attachmentId);
  if (cached) return cached;

  if (Platform.OS === 'web') return undefined;

  const file = attachmentFile(attachmentId, mimeType);
  if (file.exists) {
    localUriCache.set(attachmentId, file.uri);
    return file.uri;
  }

  return undefined;
}

/**
 * Async loader — tries the sync path first, then falls back to IndexedDB on web,
 * then falls back to downloading from the daemon via server relay.
 * Warms the in-memory cache so subsequent sync lookups succeed.
 */
export async function loadAttachmentUri(
  attachmentId: string,
  mimeType: string,
  sessionId?: string
): Promise<string | undefined> {
  const sync = getAttachmentLocalUri(attachmentId, mimeType);
  if (sync) return sync;

  if (Platform.OS === 'web') {
    try {
      const blobUrl = await loadWebBlob(attachmentId);
      if (blobUrl) {
        localUriCache.set(attachmentId, blobUrl);
        return blobUrl;
      }
    } catch (err) {
      logger.error('[loadAttachmentUri] IDB load failed', err, { attachmentId });
    }
  }

  // Last resort: download from daemon via server
  if (sessionId) {
    return downloadAttachment(sessionId, attachmentId, mimeType);
  }

  return undefined;
}

/** Track in-flight downloads to avoid duplicate requests for the same attachment. */
const downloadInflight = new Map<string, Promise<string | undefined>>();
/** Negative cache: failed attachment IDs are suppressed for 60 seconds to avoid request storms. */
const downloadFailed = new Map<string, number>();
const DOWNLOAD_RETRY_COOLDOWN_MS = 60_000;

/**
 * Download an attachment from the daemon via server relay.
 * Persists locally so future loads hit the fast path.
 */
async function downloadAttachment(
  sessionId: string,
  attachmentId: string,
  mimeType: string
): Promise<string | undefined> {
  const existing = downloadInflight.get(attachmentId);
  if (existing) return existing;

  // Negative cache: skip if recently failed
  const failedAt = downloadFailed.get(attachmentId);
  if (failedAt && Date.now() - failedAt < DOWNLOAD_RETRY_COOLDOWN_MS) return undefined;

  const promise = (async () => {
    try {
      const ack = await apiSocket.emitWithAckTimeout<{
        ok: boolean;
        data?: ArrayBuffer;
        mimeType?: string;
        error?: string;
      }>(
        'download-attachment',
        { sessionId, attachmentId, mimeType },
        30_000
      );

      if (!ack.ok || !ack.data) {
        logger.debug('[downloadAttachment] server returned not-ok', {
          attachmentId,
          error: ack.error,
        });
        downloadFailed.set(attachmentId, Date.now());
        return undefined;
      }

      // Socket.IO may return a Buffer (Node polyfill) on native — normalize to ArrayBuffer
      const bytes = ack.data instanceof ArrayBuffer ? ack.data : new Uint8Array(ack.data).buffer;
      const persistedUri = await persistAttachmentFile(
        '', // compressedUri not used when bytes are provided
        attachmentId,
        ack.mimeType ?? mimeType,
        sessionId,
        bytes
      );
      localUriCache.set(attachmentId, persistedUri);
      downloadFailed.delete(attachmentId);
      logger.info('[downloadAttachment] attachment downloaded and persisted', {
        attachmentId,
        sessionId,
        bytes: bytes.byteLength,
      });
      return persistedUri;
    } catch (err) {
      logger.debug('[downloadAttachment] failed', err, { attachmentId, sessionId });
      downloadFailed.set(attachmentId, Date.now());
      return undefined;
    } finally {
      downloadInflight.delete(attachmentId);
    }
  })();

  downloadInflight.set(attachmentId, promise);
  return promise;
}

/**
 * Persist the compressed image so it survives app/page restarts.
 * - Native: copies file to Paths.document/attachments/{id}.{ext}
 * - Web: stores raw bytes in IndexedDB
 *
 * Also records the session→attachment mapping for later cleanup.
 */
async function persistAttachmentFile(
  compressedUri: string,
  attachmentId: string,
  mimeType: string,
  sessionId: string,
  bytes?: ArrayBuffer
): Promise<string> {
  if (Platform.OS === 'web') {
    if (bytes) {
      const blobUrl = await storeWebBlob(attachmentId, bytes, mimeType);
      localUriCache.set(attachmentId, blobUrl);
      await messageDB.kvSet(`session-attachments:${sessionId}`, attachmentId, mimeType);
      return blobUrl;
    }
    localUriCache.set(attachmentId, compressedUri);
    return compressedUri;
  }
  const dest = attachmentFile(attachmentId, mimeType);
  if (!dest.exists) {
    if (bytes) {
      // Download path: atomic write via tmp → move (mirrors daemon-side pattern)
      const tmp = new File(getAttachmentDir(), `${attachmentId}.tmp`);
      if (tmp.exists) tmp.delete();
      tmp.create();
      tmp.write(new Uint8Array(bytes));
      tmp.move(dest);
    } else {
      const src = new File(compressedUri);
      src.copy(dest);
    }
  }
  await messageDB.kvSet(`session-attachments:${sessionId}`, attachmentId, mimeType);
  return dest.uri;
}

/**
 * Delete all locally stored attachment files that belong to a session.
 * Called when the session is permanently deleted so disk space is reclaimed.
 */
export async function deleteSessionAttachments(sessionId: string): Promise<void> {
  const entries = await messageDB.kvGetAll(`session-attachments:${sessionId}`);
  const ids = entries.map(e => e.key);

  if (Platform.OS === 'web') {
    try { await deleteWebBlobs(ids); } catch { /* non-critical on web */ }
  } else {
    for (const { key: id, value: mimeType } of entries) {
      try {
        const file = attachmentFile(id, mimeType);
        if (file.exists) file.delete();
      } catch (err) {
        logger.error('[deleteSessionAttachments] failed to delete file', err, { id });
      }
    }
  }

  for (const id of ids) localUriCache.delete(id);
  await messageDB.kvDeleteAll(`session-attachments:${sessionId}`);
  logger.debug('[deleteSessionAttachments] done', { sessionId, count: entries.length });
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

    // Persist to a deterministic path so the file survives app/page restarts.
    const persistedUri = await persistAttachmentFile(
      compressedUri,
      ack.attachmentId,
      mimeType,
      sessionId,
      bytes
    );
    localUriCache.set(ack.attachmentId, persistedUri);

    return {
      attachmentRef: {
        id: ack.attachmentId,
        mimeType,
        filename: asset.fileName ?? undefined,
      },
      localUri: persistedUri,
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

// ---------------------------------------------------------------------------
// Clipboard image helpers
// ---------------------------------------------------------------------------

/**
 * Check if the system clipboard currently holds an image.
 * On iOS 16+, `hasImageAsync` may return false due to pasteboard privacy
 * even when an image IS present. We always return true on native so the
 * ActionSheet is shown — the actual read in `getClipboardImage` will
 * trigger the system paste prompt and gracefully return null if empty.
 */
export async function hasClipboardImage(): Promise<boolean> {
  if (Platform.OS !== 'web') {
    // Always offer the option on native — getClipboardImage handles the
    // actual permission prompt and returns null if nothing is there.
    return true;
  }
  try {
    return await Clipboard.hasImageAsync();
  } catch {
    return false;
  }
}

export interface ClipboardImageInput {
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
}

/**
 * Upload an image obtained from the clipboard (web paste event or native
 * Clipboard.getImageAsync).  Accepts either a blob: URL (web) or a
 * data:image/…;base64,… URI (native).
 */
export async function uploadClipboardImage(
  image: ClipboardImageInput,
  sessionId: string
): Promise<UploadResult> {
  logger.info('[uploadClipboardImage] start', {
    sessionId,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
  });

  const ts = Date.now();
  const ext = image.mimeType === 'image/png' ? 'png' : 'jpg';
  let fileUri = image.uri;

  // On native, data-URIs must be persisted to a temp file first so that
  // compressImage / readFileBytes (which use expo-file-system File) can
  // access them.
  if (Platform.OS !== 'web' && image.uri.startsWith('data:')) {
    const base64 = image.uri.split(',')[1];
    if (!base64) throw new Error('Invalid clipboard data URI');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const dest = new File(Paths.cache, `clipboard_${ts}.${ext}`);
    if (dest.exists) dest.delete();
    dest.create();
    dest.write(bytes);
    fileUri = dest.uri;
    logger.info('[uploadClipboardImage] saved data-URI to file', {
      sessionId,
      destUri: dest.uri.slice(-40),
      byteLength: bytes.length,
    });
  }

  // Build an ImagePickerAsset-compatible object and delegate
  const asset: ImagePickerAsset = {
    uri: fileUri,
    mimeType: image.mimeType,
    width: image.width ?? 0,
    height: image.height ?? 0,
    fileName: `clipboard_${ts}.${ext}`,
    assetId: null,
    type: 'image',
  };

  return uploadAttachment(asset, sessionId);
}

/**
 * Read the clipboard image on native via expo-clipboard.
 * Returns a ClipboardImageInput or null if no image is available.
 *
 * On iOS 16+, `hasImageAsync()` can return false due to clipboard privacy
 * restrictions, so we also attempt `getImageAsync()` directly as a fallback.
 */
export async function getClipboardImage(): Promise<ClipboardImageInput | null> {
  // Try direct read first — on iOS 16+ the "has" check may lie due to
  // pasteboard privacy, but getImageAsync triggers the system paste
  // permission prompt and works.
  try {
    const result = await Clipboard.getImageAsync({ format: 'png' });
    if (result?.data) {
      logger.info('[getClipboardImage] got image via direct read', {
        width: result.size.width,
        height: result.size.height,
      });
      return {
        uri: result.data,
        mimeType: 'image/png',
        width: result.size.width,
        height: result.size.height,
      };
    }
  } catch (err) {
    logger.debug('[getClipboardImage] direct read failed, no image in clipboard', {
      error: String(err),
    });
  }
  return null;
}
