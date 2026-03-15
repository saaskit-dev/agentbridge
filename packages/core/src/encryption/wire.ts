/**
 * Wire-format encoding/decoding for encrypted payloads.
 *
 * All sync payloads (session messages, metadata, RPC params, etc.) go through
 * this layer before hitting the network or storage.
 *
 * Encode (sender controls):
 *   isDev → JSON.stringify (plaintext)
 *   else  → cipher.encrypt → base64
 *
 * Decode (receiver auto-detects):
 *   Starts with '{' → JSON.parse  (plaintext from a dev-mode sender)
 *   else             → base64 → cipher.decrypt
 *
 * Safety: '{' (0x7b) can never be the first character of base64-encoded
 * ciphertext — AES-GCM version byte 0x00 encodes to 'A', and NaCl nonce
 * bytes are random but the base64 alphabet does not include '{'.
 */

import type { Encryptor, Decryptor } from './types';
import { encodeBase64, decodeBase64 } from '../utils/encoding';

// ─── Single-item helpers ────────────────────────────────────────────

/**
 * Encode a single value to wire string.
 * Sender decides whether to encrypt based on isDev.
 */
export async function wireEncode(
  data: unknown,
  encryptor: Encryptor,
  isDev: boolean,
): Promise<string> {
  if (isDev) {
    return JSON.stringify(data);
  }
  const [encrypted] = await encryptor.encrypt([data]);
  return encodeBase64(encrypted);
}

/**
 * Decode a single wire string.
 * Auto-detects plaintext regardless of local isDev.
 */
export async function wireDecode(
  wireStr: string,
  decryptor: Decryptor,
): Promise<unknown | null> {
  // Plaintext detection — safe because ciphertext base64 never starts with '{'
  if (wireStr.length > 0 && wireStr[0] === '{') {
    try {
      return JSON.parse(wireStr);
    } catch {
      // Malformed JSON — fall through to base64 path
    }
  }
  const bytes = decodeBase64(wireStr);
  const [result] = await decryptor.decrypt([bytes]);
  return result ?? null;
}

// ─── Batch helpers ──────────────────────────────────────────────────

/**
 * Encode multiple values to wire strings.
 */
export async function wireEncodeBatch(
  data: unknown[],
  encryptor: Encryptor,
  isDev: boolean,
): Promise<string[]> {
  if (isDev) {
    return data.map(d => JSON.stringify(d));
  }
  const encrypted = await encryptor.encrypt(data);
  return encrypted.map(e => encodeBase64(e));
}

/**
 * Decode multiple wire strings, auto-detecting plaintext per item.
 * Plaintext items are resolved immediately; only real ciphertext
 * items are passed to the decryptor in a single batch call.
 */
export async function wireDecodeBatch(
  wireStrs: string[],
  decryptor: Decryptor,
): Promise<(unknown | null)[]> {
  const results: (unknown | null)[] = new Array(wireStrs.length);
  const toDecrypt: { index: number; bytes: Uint8Array }[] = [];

  for (let i = 0; i < wireStrs.length; i++) {
    const s = wireStrs[i];
    if (s.length > 0 && s[0] === '{') {
      try {
        results[i] = JSON.parse(s);
        continue;
      } catch { /* fall through */ }
    }
    toDecrypt.push({ index: i, bytes: decodeBase64(s) });
  }

  if (toDecrypt.length > 0) {
    const decrypted = await decryptor.decrypt(toDecrypt.map(d => d.bytes));
    for (let i = 0; i < toDecrypt.length; i++) {
      results[toDecrypt[i].index] = decrypted[i] ?? null;
    }
  }

  return results;
}

// ─── Raw bytes helpers (for already-decoded Uint8Array) ─────────────

/**
 * Detect and decode plaintext from raw bytes.
 * Useful when the caller has already base64-decoded the wire string.
 */
export function tryParsePlaintext(data: Uint8Array): unknown | undefined {
  if (data.length > 0 && data[0] === 0x7b) {
    try {
      return JSON.parse(new TextDecoder().decode(data));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Decode a single Uint8Array, trying plaintext detection first.
 */
export async function wireDecodeBytes(
  data: Uint8Array,
  decryptor: Decryptor,
): Promise<unknown | null> {
  const plain = tryParsePlaintext(data);
  if (plain !== undefined) return plain;
  const [result] = await decryptor.decrypt([data]);
  return result ?? null;
}

/**
 * Batch-decode Uint8Array[], trying plaintext detection per item.
 */
export async function wireDecodeBatchBytes(
  data: Uint8Array[],
  decryptor: Decryptor,
): Promise<(unknown | null)[]> {
  const results: (unknown | null)[] = new Array(data.length);
  const toDecrypt: { index: number; bytes: Uint8Array }[] = [];

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === 0x7b) {
      try {
        results[i] = JSON.parse(new TextDecoder().decode(data[i]));
        continue;
      } catch { /* fall through */ }
    }
    toDecrypt.push({ index: i, bytes: data[i] });
  }

  if (toDecrypt.length > 0) {
    const decrypted = await decryptor.decrypt(toDecrypt.map(d => d.bytes));
    for (let i = 0; i < toDecrypt.length; i++) {
      results[toDecrypt[i].index] = decrypted[i] ?? null;
    }
  }

  return results;
}
