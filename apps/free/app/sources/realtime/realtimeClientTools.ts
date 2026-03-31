import { z } from 'zod';
import { getCurrentRealtimeSessionId, switchCurrentSession } from './RealtimeSession';
import { formatSessionFull } from './hooks/contextFormatters';
import { sessionAbort, sessionAllow, sessionDeny } from '@/sync/ops';
import { sessionLogger } from '@/sync/appTraceStore';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/realtime/realtimeClientTools');

/**
 * Resolve the active session ID for voice tool calls.
 *
 * When the user starts voice from the home screen without a bound session,
 * currentSessionId is empty. In that case, fall back to the most recently
 * active non-archived non-deleted session so common commands work immediately
 * without waiting for the agent to call switchSession first.
 */
function resolveSessionId(): string | null {
  const current = getCurrentRealtimeSessionId();
  if (current) return current;

  const sessions = Object.values(storage.getState().sessions);
  const candidate = sessions
    .filter(s => s.status !== 'archived' && s.status !== 'deleted')
    .sort((a, b) => b.activeAt - a.activeAt)[0];

  if (candidate) {
    switchCurrentSession(candidate.id);
    sessionLogger(logger, candidate.id).debug(
      'resolveSessionId: auto-selected most recent session'
    );
    return candidate.id;
  }

  return null;
}

/**
 * Static client tools for the realtime voice interface.
 * These tools allow the voice assistant to interact with the agent.
 */
export const realtimeClientTools = {
  /**
   * Send a message to the agent
   */
  messageClaudeCode: async (parameters: unknown) => {
    const messageSchema = z.object({
      message: z.string().min(1, 'Message cannot be empty'),
    });
    const parsedMessage = messageSchema.safeParse(parameters);

    if (!parsedMessage.success) {
      logger.error('Invalid message parameter:', parsedMessage.error);
      return 'error (invalid message parameter)';
    }

    const message = parsedMessage.data.message;
    const sessionId = resolveSessionId();

    if (!sessionId) {
      logger.error('No active session');
      return 'error (no active session)';
    }

    const log = sessionLogger(logger, sessionId);
    log.debug('messageClaudeCode called with message, sending to session');
    const result = await sync.sendMessage(sessionId, message);
    if (!result.ok) {
      const reason = result.reason === 'server_disconnected' ? 'server disconnected' : 'session offline';
      return `error (${reason})`;
    }
    return "sent [DO NOT say anything else, simply say 'sent']";
  },

  /**
   * Process a permission request from the agent.
   * decision: 'allow' = approve once, 'allow_for_session' = approve all same requests this session, 'deny' = reject
   */
  processPermissionRequest: async (parameters: unknown) => {
    const messageSchema = z.object({
      decision: z.enum(['allow', 'allow_for_session', 'deny']),
    });
    const parsedMessage = messageSchema.safeParse(parameters);

    if (!parsedMessage.success) {
      logger.error('Invalid decision parameter:', parsedMessage.error);
      return "error (invalid decision parameter, expected 'allow', 'allow_for_session', or 'deny')";
    }

    const decision = parsedMessage.data.decision;
    const sessionId = resolveSessionId();

    if (!sessionId) {
      logger.error('No active session');
      return 'error (no active session)';
    }

    const log = sessionLogger(logger, sessionId);
    log.debug('processPermissionRequest called', { decision });

    const session = storage.getState().sessions[sessionId];
    const requests = session?.agentState?.requests;

    if (!requests || Object.keys(requests).length === 0) {
      log.error('No active permission request');
      return 'error (no active permission request)';
    }

    // Only process the first (oldest) pending request — applying the same decision to all
    // queued requests would silently approve unrelated, potentially dangerous tools.
    const requestId = Object.keys(requests)[0];

    const results = await Promise.allSettled([
      decision === 'allow'
        ? sessionAllow(sessionId, requestId)
        : decision === 'allow_for_session'
          ? sessionAllow(sessionId, requestId, undefined, undefined, 'approved_for_session')
          : sessionDeny(sessionId, requestId),
    ]);

    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      log.error('Failed to process permission', { requestId });
      return 'error (failed to process permission)';
    }

    return "done [DO NOT say anything else, simply say 'done']";
  },

  /**
   * Switch voice control to a different agent session.
   * Returns full context for the new session so the assistant can brief the user.
   */
  switchSession: async (parameters: unknown) => {
    const schema = z.object({ sessionId: z.string() });
    const parsed = schema.safeParse(parameters);

    if (!parsed.success) {
      logger.error('Invalid sessionId parameter:', parsed.error);
      return 'error (invalid sessionId parameter)';
    }

    const { sessionId } = parsed.data;
    const state = storage.getState();
    const session = state.sessions[sessionId];

    if (!session) {
      sessionLogger(logger, sessionId).error('Session not found');
      return 'error (session not found)';
    }

    switchCurrentSession(sessionId);
    sessionLogger(logger, sessionId).debug('switchSession called');

    const messages = state.sessionMessages[sessionId]?.messages ?? [];
    const context = formatSessionFull(session, messages);
    return `switched\n\n${context}`;
  },

  /**
   * Abort the current agent task
   */
  abortSession: async (_parameters: unknown) => {
    const sessionId = resolveSessionId();

    if (!sessionId) {
      logger.error('No active session');
      return 'error (no active session)';
    }

    const log = sessionLogger(logger, sessionId);
    log.debug('abortSession called');

    try {
      await sessionAbort(sessionId);
      return "aborted [DO NOT say anything else, simply say 'aborted']";
    } catch (error) {
      log.error('Failed to abort session:', toError(error));
      return 'error (failed to abort session)';
    }
  },
};
