/**
 * Key Derivation Functions (BIP-39 style)
 *
 *
 * Provides hierarchical deterministic key derivation using HMAC-SHA512.
 * This allows deriving multiple child keys from a single master secret.
 */

import { hmacSha512 } from './hmac';

/**
 * Key tree state for hierarchical derivation
 */
export interface KeyTreeState {
  /** Derived key (32 bytes) */
  key: Uint8Array;
  /** Chain code for further derivation (32 bytes) */
  chainCode: Uint8Array;
}

/**
 * Derive the root of a key tree from a seed
 *
 * @param seed - Master seed (typically 32+ bytes of entropy)
 * @param usage - Usage identifier (e.g., 'Free EnCoder')
 * @returns KeyTreeState with key and chainCode
 */
export async function deriveSecretKeyTreeRoot(
  seed: Uint8Array,
  usage: string
): Promise<KeyTreeState> {
  const I = await hmacSha512(new TextEncoder().encode(usage + ' Master Seed'), seed);
  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  };
}

/**
 * Derive a child key from a chain code
 *
 * @param chainCode - Parent chain code
 * @param index - Index string for this child
 * @returns KeyTreeState with derived key and new chainCode
 */
export async function deriveSecretKeyTreeChild(
  chainCode: Uint8Array,
  index: string
): Promise<KeyTreeState> {
  // Prepare data with separator
  const data = new Uint8Array([0x0, ...new TextEncoder().encode(index)]);

  // Derive key using HMAC-SHA512
  const I = await hmacSha512(chainCode, data);
  return {
    key: I.subarray(0, 32),
    chainCode: I.subarray(32),
  };
}

/**
 * Derive a key from master secret using a path
 *
 * This is the main entry point for key derivation.
 * Walks the path components to derive the final key.
 *
 * @example
 * ```typescript
 * const dataKey = await deriveKey(masterSecret, 'Free EnCoder', ['content']);
 * const analyticsKey = await deriveKey(masterSecret, 'Free Coder', ['analytics', 'id']);
 * ```
 *
 * @param master - Master secret
 * @param usage - Usage identifier for the root
 * @param path - Array of path components
 * @returns Derived key (32 bytes)
 */
export async function deriveKey(
  master: Uint8Array,
  usage: string,
  path: string[]
): Promise<Uint8Array> {
  let state = await deriveSecretKeyTreeRoot(master, usage);
  let remaining = [...path];

  while (remaining.length > 0) {
    const index = remaining[0];
    remaining = remaining.slice(1);
    state = await deriveSecretKeyTreeChild(state.chainCode, index);
  }

  return state.key;
}
