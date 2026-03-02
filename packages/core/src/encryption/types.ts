/**
 * Encryptor and Decryptor interfaces
 *
 */

/**
 * Encryptor interface - batch encryption
 */
export interface Encryptor {
  /**
   * Encrypt multiple data items
   * @param data - Array of JSON-serializable data
   * @returns Array of encrypted data as Uint8Array
   */
  encrypt(data: unknown[]): Promise<Uint8Array[]>;
}

/**
 * Decryptor interface - batch decryption
 */
export interface Decryptor {
  /**
   * Decrypt multiple data items
   * @param data - Array of encrypted data
   * @returns Array of decrypted data (null if decryption failed)
   */
  decrypt(data: Uint8Array[]): Promise<(unknown | null)[]>;
}

/**
 * Combined encryptor and decryptor
 */
export type Cipher = Encryptor & Decryptor;
