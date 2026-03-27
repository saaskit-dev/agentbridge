import { randomUUID } from 'node:crypto';
import { Socket } from 'socket.io';
import { ClientConnection, eventRouter } from '@/app/events/eventRouter';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { db } from '@/storage/db';

const log = new Logger('app/api/socket/attachmentHandler');

/** Allowed MIME types for image attachments. */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/**
 * Handles `upload-attachment` events from App clients (session-scoped, not daemon).
 *
 * Flow:
 *   App → upload-attachment → Server → (verify ownership) → daemon file-transfer → ack
 *
 * The server is a pure relay: it validates ownership and forwards the binary payload
 * to the Daemon via the session-scoped socket. No data is persisted on the server.
 */
export function attachmentHandler(
  userId: string,
  socket: Socket,
  connection: ClientConnection
): void {
  // Allow App clients (user-scoped or session-scoped, but not daemon) to upload attachments.
  // The sessionId comes from the payload, so user-scoped connections work fine.
  if (connection.isDaemon) return;

  socket.on(
    'upload-attachment',
    async (
      payload: {
        sessionId: string;
        data: Buffer | ArrayBuffer;
        mimeType: string;
        filename?: string;
      },
      ack: (result: { ok: boolean; attachmentId?: string; error?: string }) => void
    ) => {
      const { sessionId, mimeType, filename } = payload;

      // Validate MIME type before touching DB
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        log.warn('[attachmentHandler] rejected unsupported mimeType', { userId, sessionId, mimeType });
        ack({ ok: false, error: 'unsupported_mime_type' });
        return;
      }

      // Verify session ownership
      const session = await db.session.findFirst({
        where: { id: sessionId, accountId: userId },
        select: { id: true },
      });
      if (!session) {
        log.warn('[attachmentHandler] session not found or not owned by user', { userId, sessionId });
        ack({ ok: false, error: 'session_not_found' });
        return;
      }

      // Find Daemon's session socket
      const daemonConn = eventRouter.findDaemonSession(userId, sessionId);
      if (!daemonConn) {
        log.warn('[attachmentHandler] daemon not connected for session', { userId, sessionId });
        ack({ ok: false, error: 'daemon_offline' });
        return;
      }

      const id = randomUUID().replace(/-/g, '');
      const data = payload.data instanceof ArrayBuffer
        ? Buffer.from(payload.data)
        : payload.data;

      log.info('[attachmentHandler] forwarding file-transfer to daemon', {
        userId,
        sessionId,
        id,
        mimeType,
        bytes: data.byteLength,
      });

      try {
        const result = await daemonConn.socket
          .timeout(15_000)
          .emitWithAck('file-transfer', { id, sessionId, data, mimeType, filename });

        if (result?.ok) {
          ack({ ok: true, attachmentId: id });
        } else {
          log.warn('[attachmentHandler] daemon returned ok:false', { userId, sessionId, id });
          ack({ ok: false, error: 'daemon_error' });
        }
      } catch (err) {
        log.warn('[attachmentHandler] daemon emitWithAck failed (timeout or disconnect)', {
          userId,
          sessionId,
          id,
          error: String(err),
        });
        ack({ ok: false, error: 'daemon_offline' });
      }
    }
  );
}
