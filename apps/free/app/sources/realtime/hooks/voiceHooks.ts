import {
  getCurrentRealtimeSessionId,
  getVoiceSession,
  isVoiceSessionStarted,
} from '../RealtimeSession';
import { VOICE_CONFIG } from '../voiceConfig';
import {
  formatNewMessages,
  formatNewSingleMessage,
  formatReadyEvent,
  formatSessionBrief,
  formatSessionFocus,
  formatSessionFull,
  formatSessionOffline,
  formatSessionOnline,
} from './contextFormatters';
import { storage } from '@/sync/storage';
import { Message } from '@/sync/typesMessage';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/realtime/voiceHooks');

/**
 * Centralized voice assistant hooks for multi-session context updates.
 * These hooks route app events to the voice assistant with formatted context updates.
 */

interface SessionMetadata {
  summary?: { text?: string };
  path?: string;
  machineId?: string;
  [key: string]: any;
}

const shownSessions = new Set<string>();
let lastFocusSession: string | null = null;

function reportContextualUpdate(update: string | null | undefined) {
  if (VOICE_CONFIG.ENABLE_DEBUG_LOGGING) {
    logger.debug('🎤 Voice: Reporting contextual update:', update);
  }
  if (!update) return;
  const voice = getVoiceSession();
  if (VOICE_CONFIG.ENABLE_DEBUG_LOGGING) {
    logger.debug('🎤 Voice: Voice session:', voice);
  }
  if (!voice || !isVoiceSessionStarted()) return;
  voice.sendContextualUpdate(update);
}

function reportTextUpdate(update: string | null | undefined) {
  if (VOICE_CONFIG.ENABLE_DEBUG_LOGGING) {
    logger.debug('🎤 Voice: Reporting text update:', update);
  }
  if (!update) return;
  const voice = getVoiceSession();
  if (VOICE_CONFIG.ENABLE_DEBUG_LOGGING) {
    logger.debug('🎤 Voice: Voice session:', voice);
  }
  if (!voice || !isVoiceSessionStarted()) return;
  voice.sendTextMessage(update);
}

function reportSession(sessionId: string) {
  if (shownSessions.has(sessionId)) return;
  shownSessions.add(sessionId);
  const session = storage.getState().sessions[sessionId];
  if (!session) return;
  const messages = storage.getState().sessionMessages[sessionId]?.messages ?? [];
  const contextUpdate = formatSessionFull(session, messages);
  reportContextualUpdate(contextUpdate);
}

export const voiceHooks = {
  /**
   * Called when a session comes online/connects
   */
  onSessionOnline(sessionId: string, metadata?: SessionMetadata) {
    if (VOICE_CONFIG.DISABLE_SESSION_STATUS) return;

    reportSession(sessionId);
    const contextUpdate = formatSessionOnline(sessionId, metadata);
    reportContextualUpdate(contextUpdate);
  },

  /**
   * Called when a session goes offline/disconnects
   */
  onSessionOffline(sessionId: string, metadata?: SessionMetadata) {
    if (VOICE_CONFIG.DISABLE_SESSION_STATUS) return;

    reportSession(sessionId);
    const contextUpdate = formatSessionOffline(sessionId, metadata);
    reportContextualUpdate(contextUpdate);
  },

  /**
   * Called when user navigates to/views a session
   */
  onSessionFocus(sessionId: string, metadata?: SessionMetadata) {
    if (VOICE_CONFIG.DISABLE_SESSION_FOCUS) return;
    if (lastFocusSession === sessionId) return;
    lastFocusSession = sessionId;
    reportSession(sessionId);
    reportContextualUpdate(formatSessionFocus(sessionId, metadata));
  },

  /**
   * Called when agent sends a message/response
   */
  onMessages(sessionId: string, messages: Message[]) {
    if (VOICE_CONFIG.DISABLE_MESSAGES) return;

    reportSession(sessionId);
    reportContextualUpdate(formatNewMessages(sessionId, messages));
  },

  /**
   * Called when voice session starts
   */
  onVoiceStarted(sessionId: string): string {
    if (VOICE_CONFIG.ENABLE_DEBUG_LOGGING) {
      logger.debug('🎤 Voice session started for:', sessionId);
    }
    shownSessions.clear();

    const state = storage.getState();
    const parts: string[] = [];

    // Full context for the focused session
    const currentSession = state.sessions[sessionId];
    if (currentSession) {
      parts.push(
        'CURRENT SESSION:\n\n' +
          formatSessionFull(currentSession, state.sessionMessages[sessionId]?.messages ?? [])
      );
      shownSessions.add(sessionId);
    }

    // Brief listing of all sessions (active + offline, no archived/deleted)
    const allSessions = Object.values(state.sessions).filter(
      s => s.status !== 'archived' && s.status !== 'deleted'
    );
    if (allSessions.length > 0) {
      const briefs = allSessions.map(s => formatSessionBrief(s)).join('\n');
      parts.push(`ALL SESSIONS (use switchSession to switch):\n${briefs}`);
    }

    return parts.join('\n\n');
  },

  /**
   * Called when Claude Code finishes processing (ready event)
   */
  onReady(sessionId: string) {
    if (VOICE_CONFIG.DISABLE_READY_EVENTS) return;

    reportSession(sessionId);
    reportTextUpdate(formatReadyEvent(sessionId));
  },

  /**
   * Called when voice session stops
   */
  onVoiceStopped() {
    if (VOICE_CONFIG.ENABLE_DEBUG_LOGGING) {
      logger.debug('🎤 Voice session stopped');
    }
    shownSessions.clear();
  },
};
