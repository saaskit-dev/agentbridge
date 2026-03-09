import type { VoiceSession } from './types';
import { TokenStorage } from '@/auth/tokenStorage';
import { config } from '@/config';
import { fetchVoiceToken } from '@/sync/apiVoice';
import { storage, registerRealtimeSessionInfo } from '@/sync/storage';
import { t } from '@/text';
import {
  requestMicrophonePermission,
  showMicrophonePermissionDeniedAlert,
} from '@/utils/microphonePermissions';
import { Logger } from '@agentbridge/core/telemetry';
const logger = new Logger('app/realtime/RealtimeSession');

let voiceSession: VoiceSession | null = null;
let voiceSessionStarted: boolean = false;
let currentSessionId: string | null = null;

export async function startRealtimeSession(sessionId: string, initialContext?: string) {
  if (!voiceSession) {
    logger.warn('No voice session registered');
    return;
  }

  // Request microphone permission before starting voice session
  // Critical for iOS/Android - first session will fail without this
  const permissionResult = await requestMicrophonePermission();
  if (!permissionResult.granted) {
    showMicrophonePermissionDeniedAlert(permissionResult.canAskAgain);
    return;
  }

  const experimentsEnabled = storage.getState().settings.experiments;
  const agentId = __DEV__ ? config.elevenLabsAgentIdDev : config.elevenLabsAgentIdProd;

  if (!agentId) {
    logger.error('Agent ID not configured');
    return;
  }

  try {
    // Simple path: No experiments = no auth needed
    if (!experimentsEnabled) {
      currentSessionId = sessionId;
      voiceSessionStarted = true;
      await voiceSession.startSession({
        sessionId,
        initialContext,
        agentId, // Use agentId directly, no token
      });
      return;
    }

    // Experiments enabled = full auth flow
    const credentials = await TokenStorage.getCredentials();
    if (!credentials) {
      const { Modal } = require('@/modal');
      Modal.alert(t('common.error'), t('errors.authenticationFailed'));
      return;
    }

    const response = await fetchVoiceToken(credentials, sessionId);
    logger.debug('[Voice] fetchVoiceToken response:', response);

    if (!response.allowed) {
      logger.debug('[Voice] Not allowed, presenting paywall...');
      const { sync } = require('@/sync/sync');
      const result = await sync.presentPaywall();
      logger.debug('[Voice] Paywall result:', result);
      if (result.purchased) {
        await startRealtimeSession(sessionId, initialContext);
      }
      return;
    }

    currentSessionId = sessionId;
    voiceSessionStarted = true;

    if (response.token) {
      // Use token from backend
      await voiceSession.startSession({
        sessionId,
        initialContext,
        token: response.token,
        agentId: response.agentId,
      });
    } else {
      // No token (e.g. server not deployed yet) - use agentId directly
      await voiceSession.startSession({
        sessionId,
        initialContext,
        agentId,
      });
    }
  } catch (error) {
    logger.error('Failed to start realtime session:', error);
    currentSessionId = null;
    voiceSessionStarted = false;
    const { Modal } = require('@/modal');
    Modal.alert(t('common.error'), t('errors.voiceServiceUnavailable'));
  }
}

export async function stopRealtimeSession() {
  if (!voiceSession) {
    return;
  }

  try {
    await voiceSession.endSession();
    currentSessionId = null;
    voiceSessionStarted = false;
  } catch (error) {
    logger.error('Failed to stop realtime session:', error);
  }
}

export function registerVoiceSession(session: VoiceSession) {
  if (voiceSession) {
    logger.warn('Voice session already registered, replacing with new one');
  }
  voiceSession = session;
}

export function isVoiceSessionStarted(): boolean {
  return voiceSessionStarted;
}

export function getVoiceSession(): VoiceSession | null {
  return voiceSession;
}

export function getCurrentRealtimeSessionId(): string | null {
  return currentSessionId;
}

// Register with storage to avoid circular dependency
registerRealtimeSessionInfo(() => ({
  sessionId: currentSessionId,
  voiceSession,
}));
