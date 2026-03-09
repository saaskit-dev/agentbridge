/**
 * Encoding utilities
 */

export function encodeBase64(buffer: Uint8Array): string {
  return Buffer.from(buffer).toString('base64');
}

export function decodeBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

export function encodeHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function decodeHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}
