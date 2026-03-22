import { useConversation } from '@elevenlabs/react-native';
import React, { useEffect, useRef } from 'react';
import { realtimeClientTools } from './realtimeClientTools';
import { registerVoiceSession } from './RealtimeSession';
import type { VoiceSession, VoiceSessionConfig } from './types';
import { getElevenLabsCodeFromPreference } from '@/constants/Languages';
import { storage } from '@/sync/storage';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/realtime/RealtimeVoiceSession');

// Static reference to the conversation hook instance
let conversationInstance: ReturnType<typeof useConversation> | null = null;

// Global voice session implementation
class RealtimeVoiceSessionImpl implements VoiceSession {
  async startSession(config: VoiceSessionConfig): Promise<void> {
    if (!conversationInstance) {
      logger.warn('Realtime voice session not initialized');
      return;
    }

    try {
      storage.getState().setRealtimeStatus('connecting');

      // Get user's preferred language for voice assistant
      const userLanguagePreference = storage.getState().settings.voiceAssistantLanguage;
      const elevenLabsLanguage = getElevenLabsCodeFromPreference(userLanguagePreference);

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
      logger.error('Failed to start realtime session:', toError(error));
      storage.getState().setRealtimeStatus('error');
    }
  }

  async endSession(): Promise<void> {
    if (!conversationInstance) {
      return;
    }

    try {
      await conversationInstance.endSession();
      storage.getState().setRealtimeStatus('disconnected');
    } catch (error) {
      logger.error('Failed to end realtime session:', toError(error));
    }
  }

  sendTextMessage(message: string): void {
    if (!conversationInstance) {
      logger.warn('Realtime voice session not initialized');
      return;
    }

    try {
      conversationInstance.sendUserMessage(message);
    } catch (error) {
      logger.error('Failed to send text message:', toError(error));
    }
  }

  sendContextualUpdate(update: string): void {
    if (!conversationInstance) {
      logger.warn('Realtime voice session not initialized');
      return;
    }

    try {
      conversationInstance.sendContextualUpdate(update);
    } catch (error) {
      logger.error('Failed to send contextual update:', toError(error));
    }
  }
}

export const RealtimeVoiceSession: React.FC = () => {
  const conversation = useConversation({
    clientTools: realtimeClientTools,
    onConnect: data => {
      logger.debug('Realtime session connected:', data);
      storage.getState().setRealtimeStatus('connected');
      storage.getState().setRealtimeMode('idle');
    },
    onDisconnect: () => {
      logger.debug('Realtime session disconnected');
      storage.getState().setRealtimeStatus('disconnected');
      storage.getState().setRealtimeMode('idle', true); // immediate mode change
      storage.getState().clearRealtimeModeDebounce();
    },
    onMessage: data => {
      logger.debug('Realtime message:', data);
    },
    onError: error => {
      logger.warn('Realtime voice not available:', error);
      storage.getState().setRealtimeStatus('error');
      storage.getState().setRealtimeMode('idle', true); // immediate mode change
    },
    onStatusChange: data => {
      logger.debug('Realtime status change:', data);
    },
    onModeChange: data => {
      logger.debug('Realtime mode change:', data);

      // Only animate when speaking
      const mode = data.mode as string;
      const isSpeaking = mode === 'speaking';

      // Use centralized debounce logic from storage
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
