/**
 * @agentbridge/utils - Encoding Utilities
 * Base64, Hex, UTF-8 encoding/decoding functions
 */

// ============================================================================
// Base64
// ============================================================================

/**
 * Decode a base64 string to Uint8Array
 */
export function decodeBase64(base64: string, encoding: 'base64' | 'base64url' = 'base64'): Uint8Array {
  let normalizedBase64 = base64;

  if (encoding === 'base64url') {
    normalizedBase64 = base64
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const padding = normalizedBase64.length % 4;
    if (padding) {
      normalizedBase64 += '='.repeat(4 - padding);
    }
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
 * Encode a Uint8Array to base64 string
 */
export function encodeBase64(buffer: Uint8Array, encoding: 'base64' | 'base64url' = 'base64'): string {
  const binaryString = String.fromCharCode.apply(null, Array.from(buffer));
  const base64 = btoa(binaryString);

  if (encoding === 'base64url') {
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  return base64;
}

// ============================================================================
// Hex
// ============================================================================

/**
 * Decode a hex string to Uint8Array
 */
export function decodeHex(hexString: string): Uint8Array {
  const normalized = hexString.replace(/[:\s]/g, '');
  const len = normalized.length / 2;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(normalized.substr(i * 2, 2), 16);
  }

  return bytes;
}

/**
 * Encode a Uint8Array to hex string
 */
export function encodeHex(buffer: Uint8Array, format: 'normal' | 'mac' = 'normal'): string {
  const hex = Array.from(buffer)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (format === 'mac') {
    return hex.match(/.{2}/g)?.join(':') || '';
  }

  return hex;
}

// ============================================================================
// UTF-8
// ============================================================================

/**
 * Encode a string to UTF-8 bytes
 */
export function encodeUTF8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/**
 * Decode UTF-8 bytes to string
 */
export function decodeUTF8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

/**
 * Normalize string to NFKD form
 */
export function normalizeNFKD(value: string): string {
  return value.normalize('NFKD');
}
