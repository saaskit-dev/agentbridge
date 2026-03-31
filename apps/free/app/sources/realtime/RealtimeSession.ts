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
import { sessionLogger } from '@/sync/appTraceStore';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/realtime/RealtimeSession');

let voiceSession: VoiceSession | null = null;
let voiceSessionStarted: boolean = false;
let currentSessionId: string | null = null;
let isIntentionalStop: boolean = false;
let reconnectAttempts: number = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastInitialContext: string | undefined = undefined;
const MAX_RECONNECT_ATTEMPTS = 3;

export async function startRealtimeSession(sessionId: string, initialContext?: string) {
  const log = sessionLogger(logger, sessionId);
  if (initialContext !== undefined) {
    lastInitialContext = initialContext;
  }
  if (!voiceSession) {
    log.warn('No voice session registered');
    const { Modal } = require('@/modal');
    Modal.alert(t('common.error'), t('errors.voiceNotInitialized'));
    return;
  }

  // Request microphone permission before starting voice session
  // Critical for iOS/Android - first session will fail without this
  const permissionResult = await requestMicrophonePermission();
  log.debug('[Voice] microphone permission', { granted: permissionResult.granted });
  if (!permissionResult.granted) {
    showMicrophonePermissionDeniedAlert(permissionResult.canAskAgain);
    return;
  }

  const experimentsEnabled = storage.getState().settings.experiments;
  const agentId = __DEV__ ? config.elevenLabsAgentIdDev : config.elevenLabsAgentIdProd;

  if (!agentId) {
    log.error('Agent ID not configured');
    const { Modal } = require('@/modal');
    Modal.alert(t('common.error'), t('errors.voiceNotConfigured'));
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
      log.info('[Voice] session started (simple)');
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
    log.debug('[Voice] fetchVoiceToken response', { allowed: response.allowed });

    if (!response.allowed) {
      if (!response.token) {
        log.debug('[Voice] Token not available, server may not support voice');
        const { Modal } = require('@/modal');
        Modal.alert(t('common.error'), t('errors.voiceTokenRejected'));
        return;
      }
      log.debug('[Voice] Not allowed, presenting paywall');
      const { sync } = require('@/sync/sync');
      const result = await sync.presentPaywall();
      log.debug('[Voice] Paywall result', { purchased: result.purchased });
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
      log.info('[Voice] session started (with token)');
    } else {
      // No token (e.g. server not deployed yet) - use agentId directly
      await voiceSession.startSession({
        sessionId,
        initialContext,
        agentId,
      });
      log.info('[Voice] session started (agentId only)');
    }
  } catch (error) {
    log.error('Failed to start realtime session', toError(error));
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

  // Cancel any pending auto-reconnect before ending the session so the timer
  // cannot fire and restart voice after the user explicitly stopped it.
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    isIntentionalStop = true;
    await voiceSession.endSession();
    const stopLog = currentSessionId ? sessionLogger(logger, currentSessionId) : logger;
    stopLog.info('[Voice] session stopped');
    currentSessionId = null;
    voiceSessionStarted = false;
    reconnectAttempts = 0;
    lastInitialContext = undefined;
  } catch (error) {
    const errLog = currentSessionId ? sessionLogger(logger, currentSessionId) : logger;
    errLog.error('Failed to stop realtime session', toError(error));
  } finally {
    isIntentionalStop = false;
  }
}

export function shouldAutoReconnect(): boolean {
  return !isIntentionalStop && voiceSessionStarted && reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
}

export function scheduleReconnect(sessionId: string): void {
  const log = sessionLogger(logger, sessionId);
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 8000); // 1s, 2s, 4s max 8s
  log.info('[Voice] scheduling reconnect', { attempt: reconnectAttempts, delayMs: delay });
  storage.getState().setRealtimeStatus('reconnecting');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startRealtimeSession(sessionId, lastInitialContext).catch(e => {
      log.error('[Voice] auto-reconnect failed', toError(e));
    });
  }, delay);
}

export function resetReconnectAttempts(): void {
  reconnectAttempts = 0;
}

/** Switch the active agent session without restarting the ElevenLabs connection. */
export function switchCurrentSession(sessionId: string): void {
  const log = sessionLogger(logger, sessionId);
  log.info('[Voice] switched current session', { from: currentSessionId });
  currentSessionId = sessionId;
}

export function registerVoiceSession(session: VoiceSession) {
  if (voiceSession) {
    logger.warn('Voice session already registered, replacing with new one');
  } else {
    logger.debug('[Voice] voice session registered');
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
