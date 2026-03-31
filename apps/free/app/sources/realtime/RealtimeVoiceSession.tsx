import { useConversation } from '@elevenlabs/react-native';
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

/**
 * Returns a logger scoped to the current voice-bound agent session when available,
 * so ElevenLabs callbacks do not inherit a misleading global trace.
 */
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
    if (!conversationInstance) {
      log.warn('Realtime voice session not initialized');
      return;
    }

    try {
      storage.getState().setRealtimeStatus('connecting');

      const preferredLanguage = storage.getState().settings.preferredLanguage;
      const localeTag = preferredLanguage ?? (getLocales()[0]?.languageTag ?? '');
      const elevenLabsLanguage = getElevenLabsCodeFromLocale(localeTag);

      if (!config.token && !config.agentId) {
        throw new Error('Neither token nor agentId provided');
      }

      const sessionConfig: any = {
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

      await conversationInstance.startSession(sessionConfig);
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

    try {
      conversationInstance.sendUserMessage(message);
    } catch (error) {
      log.error('Failed to send text message:', toError(error));
    }
  }

  sendContextualUpdate(update: string): void {
    const log = voiceLog();
    if (!conversationInstance) {
      log.warn('Realtime voice session not initialized');
      return;
    }

    try {
      conversationInstance.sendContextualUpdate(update);
    } catch (error) {
      log.error('Failed to send contextual update:', toError(error));
    }
  }
}

export const RealtimeVoiceSession: React.FC = () => {
  const conversation = useConversation({
    clientTools: realtimeClientTools,
    onConnect: data => {
      logger.debug('Realtime session connected:', data);
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
    conversationInstance = conversation;

    // Register the voice session once
    if (!hasRegistered.current) {
      try {
        registerVoiceSession(new RealtimeVoiceSessionImpl());
        hasRegistered.current = true;
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
