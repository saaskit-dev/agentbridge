import { getServerUrl } from './serverConfig';
import { storage } from './storage';
import { AuthCredentials } from '@/auth/tokenStorage';
import { config } from '@/config';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/sync/apiVoice');

export interface VoiceTokenResponse {
  allowed: boolean;
  token?: string;
  agentId?: string;
}

export async function fetchVoiceToken(
  credentials: AuthCredentials,
  sessionId: string
): Promise<VoiceTokenResponse> {
  const serverUrl = getServerUrl();
  const userId = storage.getState().profile.id;
  logger.debug(`[Voice] User ID: ${userId}`);

  // Get agent ID from config
  const agentId = __DEV__ ? config.elevenLabsAgentIdDev : config.elevenLabsAgentIdProd;

  if (!agentId) {
    throw new Error('Agent ID not configured');
  }

  const response = await fetch(`${serverUrl}/v1/voice/token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId,
      agentId,
    }),
  });

  if (!response.ok) {
    if (response.status === 400) {
      logger.warn('[Voice] Server rejected voice token request (400)', { sessionId, serverUrl });
      return { allowed: false, token: undefined, agentId };
    }
    throw new Error(`Voice token request failed: ${response.status}`);
  }

  return await response.json();
}
