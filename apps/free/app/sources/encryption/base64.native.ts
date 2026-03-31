import { fromByteArray, toByteArray } from 'react-native-quick-base64';

export function decodeBase64(
  base64: string,
  encoding: 'base64' | 'base64url' = 'base64'
): Uint8Array {
  if (encoding === 'base64url') {
    return toByteArray(base64, true);
  }
  return toByteArray(base64, true);
}

/**
 * Decode a standard base64 payload as UTF-8 text (e.g. session file read from daemon).
 * Do not use raw `atob()` for file bodies — it mis-decodes CJK and other multibyte UTF-8.
 */
export function decodeBase64ToUtf8String(base64: string): string {
  const bytes = decodeBase64(base64, 'base64');
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Heuristic: treat as binary if NUL or too many ASCII control bytes.
 * UTF-8 CJK uses multibyte sequences >= 0x80, so they are not counted as control bytes.
 */
export function looksLikeBinaryBytes(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  if (bytes.includes(0)) return true;
  let ctrl = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) ctrl++;
  }
  return ctrl / bytes.length > 0.1;
}

export function encodeBase64(
  buffer: Uint8Array,
  encoding: 'base64' | 'base64url' = 'base64'
): string {
  return fromByteArray(buffer, encoding === 'base64url');
}
