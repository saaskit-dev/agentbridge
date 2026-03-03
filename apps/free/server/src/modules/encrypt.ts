import { KeyTree, crypto } from 'privacy-kit';

let keyTree: KeyTree | null = null;

export async function initEncrypt() {
  const secret = process.env.FREE_MASTER_SECRET;
  if (!secret) {
    throw new Error('FREE_MASTER_SECRET environment variable is not set');
  }
  keyTree = new KeyTree(
    await crypto.deriveSecureKey({
      key: secret,
      usage: 'free-server-tokens',
    })
  );
}

function getKeyTree(): KeyTree {
  if (!keyTree) {
    throw new Error('Encryption not initialized. Call initEncrypt() first.');
  }
  return keyTree;
}

export function encryptString(path: string[], string: string) {
  return getKeyTree().symmetricEncrypt(path, string);
}

export function encryptBytes(path: string[], bytes: Uint8Array<ArrayBuffer>) {
  return getKeyTree().symmetricEncrypt(path, bytes);
}

export function decryptString(path: string[], encrypted: Uint8Array<ArrayBuffer>) {
  return getKeyTree().symmetricDecryptString(path, encrypted);
}

export function decryptBytes(path: string[], encrypted: Uint8Array<ArrayBuffer>) {
  return getKeyTree().symmetricDecryptBuffer(path, encrypted);
}
