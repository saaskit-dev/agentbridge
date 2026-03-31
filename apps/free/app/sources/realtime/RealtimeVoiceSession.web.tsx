import { useConversation } from '@elevenlabs/react';
import React, { useEffect, useRef } from 'react';
import { realtimeClientTools } from './realtimeClientTools';
import {
  getCurrentRealtimeSessionId,
  registerVoiceSession,
  resetReconnectAttempts,
  scheduleReconnect,
  shouldAutoReconnect,
} from './RealtimeSession';
import type { VoiceSession, VoiceSessionConfig } from './types';
import { getElevenLabsCodeFromLocale } from '@/constants/Languages';
import { getLocales } from 'expo-localization';
import { sessionLogger, type SessionLog } from '@/sync/appTraceStore';
import { storage } from '@/sync/storage';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/realtime/RealtimeVoiceSession');

/** Scoped logger for the current voice-bound session (see native RealtimeVoiceSession). */
function voiceLog(): SessionLog {
  const sid = getCurrentRealtimeSessionId();
  return sid ? sessionLogger(logger, sid) : logger;
}

// Static reference to the conversation hook instance
let conversationInstance: ReturnType<typeof useConversation> | null = null;

// Global voice session implementation
class RealtimeVoiceSessionImpl implements VoiceSession {
  async startSession(config: VoiceSessionConfig): Promise<void> {
    const log = sessionLogger(logger, config.sessionId);
    log.debug('[RealtimeVoiceSessionImpl] conversationInstance:', conversationInstance);
    if (!conversationInstance) {
      log.warn('Realtime voice session not initialized - conversationInstance is null');
      return;
    }

    try {
      // Request microphone permission before changing status
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        log.error('Failed to get microphone permission:', toError(error));
        storage.getState().setRealtimeStatus('disconnected');
        const { Modal } = require('@/modal');
        const { t } = require('@/text');
        Modal.alert(t('common.error'), t('errors.voiceMicPermissionWeb'));
        return;
      }

      storage.getState().setRealtimeStatus('connecting');

      const preferredLanguage = storage.getState().settings.preferredLanguage;
      const localeTag = preferredLanguage ?? (getLocales()[0]?.languageTag ?? '');
      const elevenLabsLanguage = getElevenLabsCodeFromLocale(localeTag);

      if (!config.token && !config.agentId) {
        throw new Error('Neither token nor agentId provided');
      }

      const sessionConfig: any = {
        connectionType: 'webrtc',
        dynamicVariables: {
          sessionId: config.sessionId,
          initialConversationContext: config.initialContext || '',
        },
        overrides: {
          agent: {
            language: elevenLabsLanguage,
          },
        },
        ...(config.token ? { conversationToken: config.token } : { agentId: config.agentId }),
      };

      const conversationId = await conversationInstance.startSession(sessionConfig);

      log.debug('Started conversation with ID:', conversationId);
    } catch (error) {
      log.error('Failed to start realtime session:', toError(error));
      storage.getState().setRealtimeStatus('error');
    }
  }

  async endSession(): Promise<void> {
    const log = voiceLog();
    if (!conversationInstance) {
      return;
    }

    try {
      await conversationInstance.endSession();
      storage.getState().setRealtimeStatus('disconnected');
    } catch (error) {
      log.error('Failed to end realtime session:', toError(error));
    }
  }

  sendTextMessage(message: string): void {
    const log = voiceLog();
    if (!conversationInstance) {
      log.warn('Realtime voice session not initialized');
      return;
    }

    conversationInstance.sendUserMessage(message);
  }

  sendContextualUpdate(update: string): void {
    const log = voiceLog();
    if (!conversationInstance) {
      log.warn('Realtime voice session not initialized');
      return;
    }

    conversationInstance.sendContextualUpdate(update);
  }
}

export const RealtimeVoiceSession: React.FC = () => {
  const conversation = useConversation({
    clientTools: realtimeClientTools,
    onConnect: () => {
      logger.debug('Realtime session connected');
      resetReconnectAttempts();
      storage.getState().setRealtimeStatus('connected');
      storage.getState().setRealtimeMode('idle');
    },
    onDisconnect: () => {
      logger.debug('Realtime session disconnected');
      storage.getState().setRealtimeStatus('disconnected');
      storage.getState().setRealtimeMode('idle', true);
      storage.getState().clearRealtimeModeDebounce();

      const sid = getCurrentRealtimeSessionId();
      if (shouldAutoReconnect() && sid) {
        scheduleReconnect(sid);
      }
    },
    onMessage: data => {
      logger.debug('Realtime message:', data);
    },
    onError: error => {
      logger.warn('Realtime voice not available:', error);
      storage.getState().setRealtimeStatus('error');
      storage.getState().setRealtimeMode('idle', true);
    },
    onStatusChange: data => {
      logger.debug('Realtime status change:', data);
    },
    onModeChange: data => {
      logger.debug('Realtime mode change:', data);

      const mode = data.mode as string;
      const isSpeaking = mode === 'speaking';

      storage.getState().setRealtimeMode(isSpeaking ? 'speaking' : 'idle');
    },
    onDebug: message => {
      logger.debug('Realtime debug:', message);
    },
  });

  const hasRegistered = useRef(false);

  useEffect(() => {
    // Store the conversation instance globally
    logger.debug('[RealtimeVoiceSession] Setting conversationInstance:', conversation);
    conversationInstance = conversation;

    if (!hasRegistered.current) {
      try {
        logger.debug('[RealtimeVoiceSession] Registering voice session');
        registerVoiceSession(new RealtimeVoiceSessionImpl());
        hasRegistered.current = true;
        logger.debug('[RealtimeVoiceSession] Voice session registered successfully');
      } catch (error) {
        logger.error('Failed to register voice session:', toError(error));
      }
    }

    return () => {
      // Clean up on unmount
      conversationInstance = null;
    };
  }, [conversation]);

  // This component doesn't render anything visible
  return null;
};
