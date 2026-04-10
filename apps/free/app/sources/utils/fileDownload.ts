import { cacheDirectory, EncodingType, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { decodeBase64 } from '@/encryption/base64';

export async function downloadBase64File(
  fileName: string,
  base64Content: string,
  mimeType: string
): Promise<void> {
  if (Platform.OS === 'web') {
    const bytes = decodeBase64(base64Content);
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    return;
  }

  const localUri = cacheDirectory + `${Date.now().toString(36)}-${fileName}`;
  await writeAsStringAsync(localUri, base64Content, {
    encoding: EncodingType.Base64,
  });
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Sharing unavailable');
  }
  await Sharing.shareAsync(localUri, { dialogTitle: fileName });
}
