import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { useSessions } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';

const logger = new Logger('app/hooks/useWatchConnectivity');

/**
 * Sync session data to Apple Watch via react-native-watch-connectivity.
 *
 * This hook:
 * 1. Watches the Zustand store for session changes
 * 2. Sends a lightweight session summary to the Watch via applicationContext
 * 3. Listens for commands from the Watch (e.g. stopSession)
 *
 * Only runs on iOS — no-ops on other platforms.
 */
export function useWatchConnectivity() {
  if (Platform.OS !== 'ios') return;

  const watchModule = useRef<typeof import('react-native-watch-connectivity') | null>(null);
  const lastSentRef = useRef<string>('');

  // Lazy-load the watch connectivity module
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const mod = await import('react-native-watch-connectivity');
        if (!mounted) return;
        watchModule.current = mod;
        logger.debug('WatchConnectivity module loaded');

        // Listen for commands from Watch
        mod.watchEvents.on('message', (message: Record<string, unknown>) => {
          const command = message.command as string;
          logger.debug('Received watch command', { command });

          if (command === 'stopSession' && typeof message.sessionId === 'string') {
            handleStopSession(message.sessionId);
          }
        });
      } catch (e) {
        logger.debug('WatchConnectivity not available (expected in simulator)', {
          error: String(e),
        });
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  // Sync sessions to Watch whenever they change
  const sessions = useSessions();

  useEffect(() => {
    if (!watchModule.current || !sessions) return;

    const payload = sessions
      .filter((s): s is Session => typeof s !== 'string' && s.status === 'active')
      .slice(0, 20) // Limit to 20 sessions for Watch
      .map(s => ({
        id: s.id,
        projectPath: s.metadata?.path ?? '',
        host: s.metadata?.host ?? '',
        isActive: true,
        isThinking: s.thinking,
        presence: s.presence === 'online' ? 'online' : 'offline',
        presenceTimestamp: typeof s.presence === 'number' ? s.presence : null,
        summary: s.metadata?.summary?.text ?? null,
        flavor: s.metadata?.flavor ?? null,
        updatedAt: s.updatedAt,
      }));

    // Deduplicate: only send if data actually changed
    const serialized = JSON.stringify(payload);
    if (serialized === lastSentRef.current) return;
    lastSentRef.current = serialized;

    try {
      watchModule.current.updateApplicationContext({ sessions: payload });
      logger.debug('Sent session data to Watch', { count: payload.length });
    } catch (e) {
      logger.error('Failed to send data to Watch', { error: String(e) });
    }
  }, [sessions]);
}

function handleStopSession(sessionId: string) {
  // TODO: Implement session stop via existing sync layer
  // This would call the same API as the "archive session" action in the app
  logger.debug('Stop session requested from Watch', { sessionId });
}
