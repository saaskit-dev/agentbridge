/**
 * Streaming Handler for Socket.IO
 *
 * Handles streaming text events from CLI and broadcasts to connected clients.
 * Enables typewriter effect on mobile/web apps.
 */

import { Socket } from 'socket.io';
import { eventRouter, ClientConnection } from '@/app/events/eventRouter';
import { Logger, type WireTrace } from '@agentbridge/core/telemetry';
const log = new Logger('app/api/socket/streamingHandler');

/**
 * Streaming event from CLI.
 * Includes optional _trace for end-to-end trace correlation (RFC §11.5).
 */
interface StreamingEvent {
  type: 'text_delta' | 'text_complete' | 'thinking_delta';
  sessionId: string;
  messageId: string;
  delta?: string;
  fullText?: string;
  timestamp: number;
  _trace?: WireTrace;
}

export function streamingHandler(userId: string, socket: Socket, connection: ClientConnection) {
  /**
   * Handle streaming:text-delta event
   * Broadcasts text delta to all clients interested in the session
   */
  socket.on('streaming:text-delta', (data: StreamingEvent) => {
    try {
      const { sessionId, messageId, delta, timestamp, _trace } = data;

      // Validate
      if (!sessionId || !messageId || typeof delta !== 'string') {
        log.warn('Invalid streaming:text-delta event');
        return;
      }

      log.debug('[streaming] text_delta received', {
        sessionId,
        messageId,
        len: delta.length,
        traceId: _trace?.tid,
      });

      // Broadcast to all interested clients (skip sender)
      eventRouter.emitEphemeral({
        userId,
        payload: {
          type: 'text_delta',
          sessionId,
          messageId,
          delta,
          timestamp: timestamp || Date.now(),
          ...(_trace ? { _trace } : {}),
        },
        recipientFilter: { type: 'all-interested-in-session', sessionId },
        skipSenderConnection: connection,
      });
    } catch (error) {
      log.error(`Error handling streaming:text-delta: ${error}`);
    }
  });

  /**
   * Handle streaming:text-complete event
   * Signals that text streaming has finished
   */
  socket.on('streaming:text-complete', (data: StreamingEvent) => {
    try {
      const { sessionId, messageId, fullText, timestamp, _trace } = data;

      // Validate
      if (!sessionId || !messageId || typeof fullText !== 'string') {
        log.warn('Invalid streaming:text-complete event');
        return;
      }

      log.debug('[streaming] text_complete received', {
        sessionId,
        messageId,
        fullTextLen: fullText.length,
        traceId: _trace?.tid,
      });

      // Broadcast to all interested clients (skip sender)
      eventRouter.emitEphemeral({
        userId,
        payload: {
          type: 'text_complete',
          sessionId,
          messageId,
          fullText,
          timestamp: timestamp || Date.now(),
          ...(_trace ? { _trace } : {}),
        },
        recipientFilter: { type: 'all-interested-in-session', sessionId },
        skipSenderConnection: connection,
      });
    } catch (error) {
      log.error(`Error handling streaming:text-complete: ${error}`
      );
    }
  });

  /**
   * Handle streaming:thinking-delta event
   * Broadcasts thinking/reasoning text
   */
  socket.on('streaming:thinking-delta', (data: StreamingEvent) => {
    try {
      const { sessionId, messageId, delta, timestamp, _trace } = data;

      // Validate
      if (!sessionId || !messageId || typeof delta !== 'string') {
        log.warn('Invalid streaming:thinking-delta event');
        return;
      }

      // Broadcast to all interested clients (skip sender)
      eventRouter.emitEphemeral({
        userId,
        payload: {
          type: 'thinking_delta',
          sessionId,
          messageId,
          delta,
          timestamp: timestamp || Date.now(),
          ...(_trace ? { _trace } : {}),
        },
        recipientFilter: { type: 'all-interested-in-session', sessionId },
        skipSenderConnection: connection,
      });
    } catch (error) {
      log.error(`Error handling streaming:thinking-delta: ${error}`
      );
    }
  });
}
