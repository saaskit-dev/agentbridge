/**
 * Streaming Handler for Socket.IO
 *
 * Handles streaming text events from CLI and broadcasts to connected clients.
 * Enables typewriter effect on mobile/web apps.
 */

import { eventRouter, ClientConnection } from "@/app/events/eventRouter";
import { log } from "@/utils/log";
import { Socket } from "socket.io";

/**
 * Streaming event from CLI
 */
interface StreamingEvent {
    type: 'text_delta' | 'text_complete' | 'thinking_delta';
    sessionId: string;
    messageId: string;
    delta?: string;
    fullText?: string;
    timestamp: number;
}

export function streamingHandler(userId: string, socket: Socket, connection: ClientConnection) {
    /**
     * Handle streaming:text-delta event
     * Broadcasts text delta to all clients interested in the session
     */
    socket.on('streaming:text-delta', (data: StreamingEvent) => {
        try {
            const { sessionId, messageId, delta, timestamp } = data;

            // Validate
            if (!sessionId || !messageId || typeof delta !== 'string') {
                log({ module: 'websocket', level: 'warn' }, 'Invalid streaming:text-delta event');
                return;
            }

            // Broadcast to all interested clients (skip sender)
            eventRouter.emitEphemeral({
                userId,
                payload: {
                    type: 'text_delta',
                    sessionId,
                    messageId,
                    delta,
                    timestamp: timestamp || Date.now(),
                },
                recipientFilter: { type: 'all-interested-in-session', sessionId },
                skipSenderConnection: connection,
            });

        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error handling streaming:text-delta: ${error}`);
        }
    });

    /**
     * Handle streaming:text-complete event
     * Signals that text streaming has finished
     */
    socket.on('streaming:text-complete', (data: StreamingEvent) => {
        try {
            const { sessionId, messageId, fullText, timestamp } = data;

            // Validate
            if (!sessionId || !messageId || typeof fullText !== 'string') {
                log({ module: 'websocket', level: 'warn' }, 'Invalid streaming:text-complete event');
                return;
            }

            // Broadcast to all interested clients (skip sender)
            eventRouter.emitEphemeral({
                userId,
                payload: {
                    type: 'text_complete',
                    sessionId,
                    messageId,
                    fullText,
                    timestamp: timestamp || Date.now(),
                },
                recipientFilter: { type: 'all-interested-in-session', sessionId },
                skipSenderConnection: connection,
            });

        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error handling streaming:text-complete: ${error}`);
        }
    });

    /**
     * Handle streaming:thinking-delta event
     * Broadcasts thinking/reasoning text
     */
    socket.on('streaming:thinking-delta', (data: StreamingEvent) => {
        try {
            const { sessionId, messageId, delta, timestamp } = data;

            // Validate
            if (!sessionId || !messageId || typeof delta !== 'string') {
                log({ module: 'websocket', level: 'warn' }, 'Invalid streaming:thinking-delta event');
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
                },
                recipientFilter: { type: 'all-interested-in-session', sessionId },
                skipSenderConnection: connection,
            });

        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error handling streaming:thinking-delta: ${error}`);
        }
    });
}
