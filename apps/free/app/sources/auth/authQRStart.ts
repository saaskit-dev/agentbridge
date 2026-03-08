import axios from 'axios';
import { getRandomBytes } from 'expo-crypto';
import { encodeBase64 } from '../encryption/base64';
import sodium from '@/encryption/libsodium.lib';
import { getServerUrl } from '@/sync/serverConfig';
import { Logger } from '@agentbridge/core/telemetry';
const logger = new Logger('app/auth/authQRStart');

export interface QRAuthKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateAuthKeyPair(): QRAuthKeyPair {
  const secret = getRandomBytes(32);
  const keypair = sodium.crypto_box_seed_keypair(secret);
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.privateKey,
  };
}

export async function authQRStart(keypair: QRAuthKeyPair): Promise<boolean> {
  try {
    const serverUrl = getServerUrl();
    logger.debug(`[AUTH] Sending auth request to: ${serverUrl}/v1/auth/account/request`);
    logger.debug(`[AUTH] Public key: ${encodeBase64(keypair.publicKey).substring(0, 20)}...`);

    const response = await axios.post(`${serverUrl}/v1/auth/account/request`, {
      publicKey: encodeBase64(keypair.publicKey),
    });

    logger.debug('[AUTH] Auth request sent successfully, response:', response.data);
    return true;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('[AUTH] Axios error:', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('[AUTH] Failed to send auth request:', error);
    }
    logger.debug('Failed to create authentication request, please try again later.');
    return false;
  }
}
