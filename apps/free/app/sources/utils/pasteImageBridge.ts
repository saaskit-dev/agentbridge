/**
 * Global paste-image bridge for web.
 *
 * Metro's lazy loading means component-level useEffects in lazily-loaded
 * modules may not run when expected. This module is imported from _layout.tsx
 * (which always loads eagerly) and registers a single document-level paste
 * listener. Input components subscribe via `usePasteImage()`.
 */
import { Platform } from 'react-native';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/utils/pasteImageBridge');

export interface PastedImage {
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
}

type PasteHandler = (images: PastedImage[]) => void;

let _handler: PasteHandler | null = null;
let _initialized = false;

/** Subscribe to paste-image events. Returns unsubscribe function. */
export function subscribePasteImage(handler: PasteHandler): () => void {
  _handler = handler;
  return () => {
    if (_handler === handler) _handler = null;
  };
}

/** Call once from _layout.tsx to register the document paste listener. */
export function initPasteImageBridge(): void {
  if (_initialized || Platform.OS !== 'web') return;
  _initialized = true;

  document.addEventListener('paste', (e: ClipboardEvent) => {
    if (!_handler) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;

    e.preventDefault();
    logger.debug('[pasteImageBridge] intercepted image paste', { count: imageFiles.length });

    const images: PastedImage[] = [];
    let remaining = imageFiles.length;

    for (const file of imageFiles) {
      const blobUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        images.push({
          uri: blobUrl,
          mimeType: file.type,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
        remaining--;
        if (remaining === 0 && _handler) {
          logger.debug('[pasteImageBridge] delivering images', { count: images.length });
          _handler(images);
        }
      };
      img.onerror = () => {
        images.push({ uri: blobUrl, mimeType: file.type });
        remaining--;
        if (remaining === 0 && _handler) _handler(images);
      };
      img.src = blobUrl;
    }
  });

  logger.debug('[pasteImageBridge] initialized');
}
