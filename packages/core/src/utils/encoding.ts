/**
 * Encoding utilities - based on free/cli actual implementation
 * Platform-agnostic base64 encoding/decoding
 */

/**
 * Encode a Uint8Array to base64 string
 */
export function encodeBase64(buffer: Uint8Array): string {
  // Use Buffer in Node.js, btoa in browser
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  // Browser fallback
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

/**
 * Encode a Uint8Array to base64url string (URL-safe base64)
 * Base64URL uses '-' instead of '+', '_' instead of '/', and removes padding
 */
export function encodeBase64Url(buffer: Uint8Array): string {
  return encodeBase64(buffer).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * Decode a base64 string to a Uint8Array
 */
export function decodeBase64(base64: string): Uint8Array {
  // Use Buffer in Node.js, atob in browser
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  // Browser fallback
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode a base64url string to a Uint8Array
 */
export function decodeBase64Url(base64url: string): Uint8Array {
  // Convert base64url to base64
  const base64 =
    base64url.replaceAll('-', '+').replaceAll('_', '/') +
    '='.repeat((4 - (base64url.length % 4)) % 4);
  return decodeBase64(base64);
}

/**
 * Encode a string to UTF-8 bytes
 */
export function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Decode UTF-8 bytes to a string
 */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Encode bytes to hex string
 */
export function encodeHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Decode hex string to bytes
 */
export function decodeHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
