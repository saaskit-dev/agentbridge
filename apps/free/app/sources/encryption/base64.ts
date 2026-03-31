/**
 * Normalizes PEM-style base64 (strip whitespace, fix padding) so `atob` does not throw on RPC payloads.
 */
function normalizeStandardBase64(input: string): string {
  let s = input.replace(/\s/g, '');
  const pad = s.length % 4;
  if (pad) {
    s += '='.repeat(4 - pad);
  }
  return s;
}

export function decodeBase64(
  base64: string,
  encoding: 'base64' | 'base64url' = 'base64'
): Uint8Array {
  let normalizedBase64 = base64;

  if (encoding === 'base64url') {
    normalizedBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');

    const padding = normalizedBase64.length % 4;
    if (padding) {
      normalizedBase64 += '='.repeat(4 - padding);
    }
  } else {
    normalizedBase64 = normalizeStandardBase64(base64);
  }

  const binaryString = atob(normalizedBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
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
 * Heuristic: treat as binary if NUL or too many ASCII control bytes (same spirit as pre-UTF8 atob heuristic).
 * UTF-8 CJK uses multibyte sequences ≥ 0x80, so they are not counted as control bytes.
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
  const binaryString = String.fromCharCode.apply(null, Array.from(buffer));
  const base64 = btoa(binaryString);

  if (encoding === 'base64url') {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  return base64;
}
