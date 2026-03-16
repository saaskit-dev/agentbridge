import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import tweetnacl from 'tweetnacl';
import { configuration } from '@/configuration';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify, toError, wireEncode, wireDecode } from '@saaskit-dev/agentbridge';
import type { Cipher } from '@saaskit-dev/agentbridge';

const logger = new Logger('cli/api/encryption');

/**
 * Encode a Uint8Array to base64 string
 * @param buffer - The buffer to encode
 * @param variant - The encoding variant ('base64' or 'base64url')
 */
export function encodeBase64(
  buffer: Uint8Array,
  variant: 'base64' | 'base64url' = 'base64'
): string {
  if (variant === 'base64url') {
    return encodeBase64Url(buffer);
  }
  return Buffer.from(buffer).toString('base64');
}

/**
 * Encode a Uint8Array to base64url string (URL-safe base64)
 * Base64URL uses '-' instead of '+', '_' instead of '/', and removes padding
 */
export function encodeBase64Url(buffer: Uint8Array): string {
  return Buffer.from(buffer)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/**
 * Decode a base64 string to a Uint8Array
 * @param base64 - The base64 string to decode
 * @param variant - The encoding variant ('base64' or 'base64url')
 * @returns The decoded Uint8Array
 */
export function decodeBase64(
  base64: string,
  variant: 'base64' | 'base64url' = 'base64'
): Uint8Array {
  if (variant === 'base64url') {
    // Convert base64url to base64
    const base64Standard =
      base64.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (base64.length % 4)) % 4);
    return new Uint8Array(Buffer.from(base64Standard, 'base64'));
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Generate secure random bytes
 */
export function getRandomBytes(size: number): Uint8Array {
  return new Uint8Array(randomBytes(size));
}

export function libsodiumPublicKeyFromSecretKey(seed: Uint8Array): Uint8Array {
  // NOTE: This matches libsodium implementation, tweetnacl doesnt do this by default
  const hashedSeed = new Uint8Array(createHash('sha512').update(seed).digest());
  const secretKey = hashedSeed.slice(0, 32);
  return new Uint8Array(tweetnacl.box.keyPair.fromSecretKey(secretKey).publicKey);
}

export function libsodiumEncryptForPublicKey(
  data: Uint8Array,
  recipientPublicKey: Uint8Array
): Uint8Array {
  // Generate ephemeral keypair for this encryption
  const ephemeralKeyPair = tweetnacl.box.keyPair();

  // Generate random nonce (24 bytes for box encryption)
  const nonce = getRandomBytes(tweetnacl.box.nonceLength);

  // Encrypt the data using box (authenticated encryption)
  const encrypted = tweetnacl.box(data, nonce, recipientPublicKey, ephemeralKeyPair.secretKey);

  // Bundle format: ephemeral public key (32 bytes) + nonce (24 bytes) + encrypted data
  const result = new Uint8Array(
    ephemeralKeyPair.publicKey.length + nonce.length + encrypted.length
  );
  result.set(ephemeralKeyPair.publicKey, 0);
  result.set(nonce, ephemeralKeyPair.publicKey.length);
  result.set(encrypted, ephemeralKeyPair.publicKey.length + nonce.length);

  return result;
}

/**
 * Encrypt data using the secret key
 * @param data - The data to encrypt
 * @param secret - The secret key to use for encryption
 * @returns The encrypted data
 */
export function encryptLegacy(data: any, secret: Uint8Array): Uint8Array {
  const nonce = getRandomBytes(tweetnacl.secretbox.nonceLength);
  const encrypted = tweetnacl.secretbox(
    new TextEncoder().encode(JSON.stringify(data)),
    nonce,
    secret
  );
  const result = new Uint8Array(nonce.length + encrypted.length);
  result.set(nonce);
  result.set(encrypted, nonce.length);
  return result;
}

/**
 * Decrypt data using the secret key
 * @param data - The data to decrypt
 * @param secret - The secret key to use for decryption
 * @returns The decrypted data
 */
export function decryptLegacy(data: Uint8Array, secret: Uint8Array): any | null {
  const nonce = data.slice(0, tweetnacl.secretbox.nonceLength);
  const encrypted = data.slice(tweetnacl.secretbox.nonceLength);
  const decrypted = tweetnacl.secretbox.open(encrypted, nonce, secret);
  if (!decrypted) {
    // Decryption failed - returning null is sufficient for error handling
    // Callers should handle the null case appropriately
    return null;
  }
  return JSON.parse(new TextDecoder().decode(decrypted));
}

/**
 * Encrypt data using AES-256-GCM with the data encryption key
 * @param data - The data to encrypt
 * @param dataKey - The 32-byte AES-256 key
 * @returns The encrypted data bundle (nonce + ciphertext + auth tag)
 */
export function encryptWithDataKey(data: any, dataKey: Uint8Array): Uint8Array {
  const nonce = getRandomBytes(12); // GCM uses 12-byte nonces
  const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);

  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Bundle: version(1) + nonce (12) + ciphertext + auth tag (16)
  const bundle = new Uint8Array(12 + encrypted.length + 16 + 1);
  bundle.set([0], 0);
  bundle.set(nonce, 1);
  bundle.set(new Uint8Array(encrypted), 13);
  bundle.set(new Uint8Array(authTag), 13 + encrypted.length);

  return bundle;
}

/**
 * Decrypt data using AES-256-GCM with the data encryption key
 * @param bundle - The encrypted data bundle
 * @param dataKey - The 32-byte AES-256 key
 * @returns The decrypted data or null if decryption fails
 */
export function decryptWithDataKey(bundle: Uint8Array, dataKey: Uint8Array): any | null {
  if (bundle.length < 1) {
    return null;
  }
  if (bundle[0] !== 0) {
    // Only verision 0
    return null;
  }
  if (bundle.length < 12 + 16 + 1) {
    // Minimum: version nonce + auth tag
    return null;
  }

  const nonce = bundle.slice(1, 13);
  const authTag = bundle.slice(bundle.length - 16);
  const ciphertext = bundle.slice(13, bundle.length - 16);

  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, nonce);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (error) {
    // Decryption failed
    return null;
  }
}

export function encrypt(key: Uint8Array, variant: 'legacy' | 'dataKey', data: any): Uint8Array {
  if (configuration.isDev) {
    return Buffer.from(JSON.stringify(data));
  }
  if (variant === 'legacy') {
    return encryptLegacy(data, key);
  } else {
    return encryptWithDataKey(data, key);
  }
}

export function decrypt(
  key: Uint8Array,
  variant: 'legacy' | 'dataKey',
  data: Uint8Array
): any | null {
  // Plain JSON from a dev-mode sender: '{' (0x7b) is never a valid first byte
  // of NaCl nonce or AES-GCM ciphertext (version byte 0x00), so the heuristic is safe.
  if (data[0] === 0x7b) {
    try {
      return JSON.parse(Buffer.from(data).toString('utf-8'));
    } catch {
      // Fall through to normal decryption
    }
  }
  if (variant === 'legacy') {
    return decryptLegacy(data, key);
  } else {
    return decryptWithDataKey(data, key);
  }
}

/**
 * Create a Cipher adapter that wraps the sync encrypt/decrypt functions
 * into the async Cipher interface expected by core's wire encode/decode.
 */
export function createCipher(key: Uint8Array, variant: 'legacy' | 'dataKey'): Cipher {
  return {
    encrypt(data: unknown[]): Promise<Uint8Array[]> {
      return Promise.resolve(data.map(item => {
        if (variant === 'legacy') {
          return encryptLegacy(item, key);
        } else {
          return encryptWithDataKey(item, key);
        }
      }));
    },
    decrypt(data: Uint8Array[]): Promise<(unknown | null)[]> {
      return Promise.resolve(data.map(item => {
        if (variant === 'legacy') {
          return decryptLegacy(item, key);
        } else {
          return decryptWithDataKey(item, key);
        }
      }));
    },
  };
}

/**
 * Encrypt data and encode to a wire string for server transmission.
 * In dev mode, skips both encryption and base64 — returns plain JSON.
 */
export async function encryptToWireString(key: Uint8Array, variant: 'legacy' | 'dataKey', data: any): Promise<string> {
  const format = configuration.isDev ? 'plaintext-json' : `base64-${variant}`;
  logger.debug('[encryption] encryptToWireString', { variant, format });
  return wireEncode(data, createCipher(key, variant), configuration.isDev);
}

/**
 * Decode and decrypt a wire string received from the server.
 * Auto-detects plaintext JSON regardless of local isDev.
 */
export async function decryptFromWireString(key: Uint8Array, variant: 'legacy' | 'dataKey', wireStr: string): Promise<any | null> {
  const isPlaintext = wireStr.length > 0 && wireStr[0] === '{';
  const format = isPlaintext ? 'plaintext-json' : `base64-${variant}`;
  logger.debug('[encryption] decryptFromWireString', { variant, format, wireStrLength: wireStr.length });
  try {
    return await wireDecode(wireStr, createCipher(key, variant));
  } catch (e) {
    logger.error('[encryption] decryptFromWireString: decryption failed', toError(e), { variant, format });
    return null;
  }
}

export function authChallenge(secret: Uint8Array): {
  challenge: Uint8Array;
  publicKey: Uint8Array;
  signature: Uint8Array;
} {
  const keypair = tweetnacl.sign.keyPair.fromSeed(secret);
  const challenge = getRandomBytes(32);
  const signature = tweetnacl.sign.detached(challenge, keypair.secretKey);

  return {
    challenge,
    publicKey: keypair.publicKey,
    signature,
  };
}
